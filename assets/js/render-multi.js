async function getJSON(p){const r=await fetch(p,{cache:'no-store'});if(!r.ok) throw new Error('load '+p);return r.json();}
function money(c){return `$${(c/100).toFixed(2)}`;}
function currentOrg(){const m=location.pathname.match(/^\/([^\/]+)\//);return m?m[1]:'';}

async function renderGroupHome(){
  const org=currentOrg();
  const homeBanquets=document.getElementById('home-banquets');
  const homeProducts=document.getElementById('home-products');
  if(homeBanquets){
    const banquets=await getJSON(`/data/${org}/banquets.json`);
    homeBanquets.innerHTML=(banquets.events||[]).slice(0,8).map(ev=>`
      <div class="card"><h3>${ev.title}</h3><p>${new Date(ev.datetime_iso).toLocaleString()}</p><p>${ev.venue||''}</p></div>
    `).join('');
  }
  if(homeProducts){
    const products=await getJSON(`/data/${org}/products.json`);
    homeProducts.innerHTML=(products.items||[]).slice(0,3).map(p=>`
      <div class="card"><h3>${p.name}</h3><p>${p.description||''}</p><div class="price">${money(p.price_cents)}</div></div>
    `).join('');
  }
}

async function renderBanquets(){
  const org=currentOrg();
  const data=await getJSON(`/data/${org}/banquets.json`);
  const el=document.getElementById('banquet-list');
  if(el){el.innerHTML=(data.events||[]).map(ev=>`
    <div class="card">
      <h3>${ev.title}</h3><p><strong>${new Date(ev.datetime_iso).toLocaleString()}</strong> — ${ev.venue||''}</p>
      ${(ev.tickets||[]).map(t=>`<div class="mt">${t.label} — ${money(t.price_cents)}</div>`).join('')}
      <p class="tiny">Meals: ${(ev.meals||[]).map(m=>m.label).join(', ')}</p>
    </div>`).join('');}
}

async function renderDirectory(){
  const org=currentOrg();const el=document.getElementById('directory-info');
  if(!el) return; const s=await getJSON(`/data/${org}/settings.json`);
  el.textContent=s.directory?.blurb||'Purchase a printed directory via the Order page.';
}

async function renderShop(){
  const org=currentOrg();const data=await getJSON(`/data/${org}/products.json`);
  const grid=document.getElementById('product-grid');
  if(grid){grid.innerHTML=(data.items||[]).map(p=>`
    <div class="card"><h3>${p.name}</h3><p>${p.description||''}</p><div class="price">${money(p.price_cents)}</div></div>`).join('');}
}

// ===== ORDER =====
let STATE=null;
function surchargeOf(base){
  const s=STATE.settings?.surcharge||{};const P=Number(s.fee_percent||0),F=Number(s.fee_fixed_cents||0),CAP=Number(s.cap_percent||0);
  if(!s.enabled||(P<=0&&F<=0)) return 0;
  const gross=Math.ceil((base+F)/(1-P)); let sur=gross-base;
  if(CAP>0){const capPct=Math.floor(base*CAP); if(sur>capPct) sur=capPct;} return sur;
}

// Registration price helper (from products)
function regPriceCents(){
  const p=(STATE.products.items||[]).find(x=>x.handle==='registration');
  return p ? Number(p.price_cents||0) : 0;
}

async function renderOrder(){
  const org=currentOrg(); if(!org) return;
  const [products,banquets,settings]=await Promise.all([
    getJSON(`/data/${org}/products.json`),
    getJSON(`/data/${org}/banquets.json`),
    getJSON(`/data/${org}/settings.json`)
  ]);
  STATE={org, attendees:[], store:{}, storeNotes:{}, products, banquets, settings};

  document.getElementById('add-attendee')?.addEventListener('click', addAttendee);
  addAttendee();

  // ----- Add Items (store) -----
  const store=document.getElementById('store-list');
  if(store){
    // classify into Event add-ons vs Merchandise
    const addonsHandles = new Set(['directory','corsage']); // adjust if your directory handle differs
    const items = (products.items||[]);
    const addons = items.filter(p => addonsHandles.has(p.handle) && p.handle!=='registration');
    const merch  = items.filter(p => !addonsHandles.has(p.handle) && p.handle!=='registration');

    // renderer for normal product
    const renderItem = (p) => {
      const q=STATE.store[p.handle]||0;
      return `
        <div class="card">
          <h3>${p.name}</h3>
          <p>${p.description||''}</p>
          <div class="price">${money(p.price_cents)}</div>
          <label>Qty <input type="number" min="0" value="${q}" data-handle="${p.handle}" class="store-qty"></label>
        </div>`;
    };

    // special renderer for corsage product
    const renderCorsage = (p) => {
      const qty=STATE.store['corsage']||0;
      const note=STATE.storeNotes['corsage']||'';
      const presets=['Red Roses','Pink Roses','Yellow Roses','Spring Flowers'];
      const selected=presets.includes(note)?note:(note?'Custom':'Red Roses');
      const customText=(selected==='Custom' && !presets.includes(note))?note:'';
      return `
        <div class="card">
          <h3>${p.name} ($${(p.price_cents/100).toFixed(0)})</h3>
          <p>${p.description||''}</p>
          <div class="grid-3">
            <label>Style
              <select id="corsage-style">
                <option value="Red Roses"${selected==='Red Roses'?' selected':''}>Red Roses</option>
                <option value="Pink Roses"${selected==='Pink Roses'?' selected':''}>Pink Roses</option>
                <option value="Yellow Roses"${selected==='Yellow Roses'?' selected':''}>Yellow Roses</option>
                <option value="Spring Flowers"${selected==='Spring Flowers'?' selected':''}>Spring Flowers</option>
                <option value="Custom"${selected==='Custom'?' selected':''}>Custom</option>
              </select>
            </label>
            <label>Custom text (if Custom)
              <input type="text" id="corsage-custom" placeholder="Describe your request" value="${customText}">
            </label>
            <label>Qty
              <input type="number" id="corsage-qty" min="0" value="${qty}">
            </label>
          </div>
        </div>`;
    };

    const addonsHTML = addons.map(p => p.handle==='corsage' ? renderCorsage(p) : renderItem(p)).join('');
    const merchHTML  = merch.map(renderItem).join('');

    // >>> Ensured stacking: merchandise is below add-ons <<<
    store.innerHTML = `
      <div class="store-sections">
        <section class="card store-addons">
          <h2>Event add-ons</h2>
          <div class="grid-2">
            ${addonsHTML || '<div class="tiny">No add-ons available.</div>'}
          </div>
        </section>

        <section class="card store-merch" style="margin-top:24px">
          <h2>Merchandise</h2>
          <div class="grid-3">
            ${merchHTML || '<div class="tiny">No merchandise available.</div>'}
          </div>
        </section>
      </div>
    `;

    // qty handlers for normal items (both sections)
    document.querySelectorAll('.store-qty').forEach(inp=>{
      inp.addEventListener('input',e=>{
        const h=e.target.getAttribute('data-handle');
        const v=Math.max(0,Number(e.target.value||0));
        if(v===0) delete STATE.store[h]; else STATE.store[h]=v;
        updateTotal();
      });
    });

    // corsage handlers (if present)
    const cq=document.getElementById('corsage-qty');
    const cs=document.getElementById('corsage-style');
    const cc=document.getElementById('corsage-custom');
    function syncCorsage(){
      if(!cq||!cs||!cc) return;
      const qty=Math.max(0,Number(cq.value||0));
      const style=cs.value;
      const custom=(cc.value||'').trim();
      if(qty>0){
        STATE.store['corsage']=qty;
        STATE.storeNotes['corsage']=(style==='Custom')?(custom||'Custom'):style;
      }else{
        delete STATE.store['corsage'];
        delete STATE.storeNotes['corsage'];
      }
      updateTotal();
    }
    cq?.addEventListener('input',syncCorsage);
    cs?.addEventListener('change',syncCorsage);
    cc?.addEventListener('input',syncCorsage);
  }

  // ----- Donation -----
  const donateWrap=document.getElementById('extra-donation');
  if(donateWrap && settings.donations?.allow_extra_on_order){
    donateWrap.innerHTML=`<p>${settings.donations.purpose_text||''}</p>
      <div id="donation-quick"></div>
      <label>Custom amount (USD) <input type="number" id="donation-amount" min="0" step="1" value="${settings.donations.default_amount||0}"></label>`;
    const quick=donateWrap.querySelector('#donation-quick');
    if(quick){
      quick.innerHTML=(settings.donations.suggested||[]).map(v=>`<button class="btn" data-dn="${v}">$${v}</button>`).join(' ');
      quick.querySelectorAll('[data-dn]').forEach(b=>b.addEventListener('click',e=>{
        const val=Number(e.currentTarget.getAttribute('data-dn')||0);
        const inp=document.getElementById('donation-amount'); if(inp) inp.value=val; updateTotal();
      }));
    }
    donateWrap.querySelector('#donation-amount')?.addEventListener('input', updateTotal);
  }

  document.getElementById('checkout')?.addEventListener('click', checkout);
  updateTotal();
}

function attendeeCard(i){
  const evs=STATE.banquets.events||[];
  const blocks=evs.map((ev,idx)=>{
    const tickets=(ev.tickets||[]).map(t=>`<option value="${t.handle}|${t.price_cents}">${ev.title} — ${t.label} — ${money(t.price_cents)}</option>`).join('');
    const meals=(ev.meals||[]).map(m=>`<option value="${m.code}">${m.label}</option>`).join('');
    return `<div class="card mt"><h4>${ev.title} — ${new Date(ev.datetime_iso).toLocaleString()}</h4>
      <div class="grid-3">
        <label>Ticket<select class="ticket" data-i="${i}" data-ev="${idx}"><option value="">-- none --</option>${tickets}</select></label>
        <label>Meal<select class="meal" data-i="${i}" data-ev="${idx}">${meals}</select></label>
        <label>Dietary<input type="text" class="diet" data-i="${i}" data-ev="${idx}" placeholder="e.g., gluten-free"></label>
      </div></div>`;
  }).join('');

  // Per-attendee Registration callout (styled)
  const checked = STATE.attendees[i]?.registration ? ' checked' : '';
  const activeClass = STATE.attendees[i]?.registration ? ' active' : '';
  const regBlock = `
    <div class="reg-box${activeClass}" data-i="${i}">
      <label style="display:flex;align-items:center;gap:.6rem;margin:0;">
        <input type="checkbox" class="a-register" data-i="${i}"${checked}>
        <div>
          <div class="title">
            Register this attendee
            <span class="price-chip">${money(regPriceCents())}</span>
          </div>
          <div class="hint">Optional – adds a registration tied to this person’s name.</div>
        </div>
      </label>
    </div>`;

  return `<div class="card mt" id="att-${i}">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h3>Attendee ${i+1}</h3><button class="btn" onclick="removeAttendee(${i})">Remove</button>
    </div>
    <div class="grid-3">
      <label>Full name<input type="text" class="a-name" data-i="${i}" required></label>
      <label>Email (optional)<input type="email" class="a-email" data-i="${i}"></label>
      <label>Title (optional)<input type="text" class="a-title" data-i="${i}"></label>
    </div>
    ${blocks}
    ${regBlock}
  </div>`;
}

function renderAttendees(){
  document.getElementById('attendee-list').innerHTML=STATE.attendees.map((a,i)=>attendeeCard(i)).join('');
  bindAttendeeInputs();
}

function addAttendee(){
  STATE.attendees.push({name:'',email:'',title:'',selections:[], registration:false});
  renderAttendees();
}

function removeAttendee(i){
  STATE.attendees.splice(i,1);
  renderAttendees();
  updateTotal();
}

function bindAttendeeInputs(){
  document.querySelectorAll('.a-name').forEach(el=>el.addEventListener('input',e=>{const i=Number(e.target.getAttribute('data-i')); STATE.attendees[i].name=e.target.value;}));
  document.querySelectorAll('.a-email').forEach(el=>el.addEventListener('input',e=>{const i=Number(e.target.getAttribute('data-i')); STATE.attendees[i].email=e.target.value;}));
  document.querySelectorAll('.a-title').forEach(el=>el.addEventListener('input',e=>{const i=Number(e.target.getAttribute('data-i')); STATE.attendees[i].title=e.target.value;}));
  document.querySelectorAll('.ticket').forEach(sel=>sel.addEventListener('change',e=>{const i=Number(e.target.getAttribute('data-i'));const ev=Number(e.target.getAttribute('data-ev'));const [h,c]=e.target.value?e.target.value.split('|'):[null,0]; if(!STATE.attendees[i].selections[ev]) STATE.attendees[i].selections[ev]={}; STATE.attendees[i].selections[ev].handle=h; STATE.attendees[i].selections[ev].price_cents=Number(c||0); updateTotal();}));
  document.querySelectorAll('.meal').forEach(sel=>sel.addEventListener('change',e=>{const i=Number(e.target.getAttribute('data-i'));const ev=Number(e.target.getAttribute('data-ev')); if(!STATE.attendees[i].selections[ev]) STATE.attendees[i].selections[ev]={}; STATE.attendees[i].selections[ev].meal=e.target.value;}));
  document.querySelectorAll('.diet').forEach(inp=>inp.addEventListener('input',e=>{const i=Number(e.target.getAttribute('data-i'));const ev=Number(e.target.getAttribute('data-ev')); if(!STATE.attendees[i].selections[ev]) STATE.attendees[i].selections[ev]={}; STATE.attendees[i].selections[ev].dietary=e.target.value;}));

  // Enhanced registration toggle: update state + visual class
  document.querySelectorAll('.a-register').forEach(chk=>{
    const box = chk.closest('.reg-box');
    const i = Number(chk.getAttribute('data-i'));
    const sync = () => {
      STATE.attendees[i].registration = !!chk.checked;
      if (box) box.classList.toggle('active', chk.checked);
      updateTotal();
    };
    chk.addEventListener('change', sync);
    // initialize visuals based on current state
    sync();
  });
}

function updateTotal(){
  let total=0;

  // banquet tickets
  STATE.attendees.forEach(a=>(a.selections||[]).forEach(sel=>{if(sel?.handle){total+=sel.price_cents+surchargeOf(sel.price_cents);}}));

  // per-attendee registration
  const regCents = regPriceCents();
  if(regCents>0){
    STATE.attendees.forEach(a=>{ if(a.registration){ total += regCents + surchargeOf(regCents); } });
  }

  // store items (including directory + corsage + merch)
  (STATE.products.items||[]).forEach(p=>{
    const q=Number(STATE.store[p.handle]||0);
    if(q>0){ for(let i=0;i<q;i++){ total += p.price_cents + surchargeOf(p.price_cents); } }
  });

  // donation
  const dn=document.getElementById('donation-amount'); 
  const dnCents=dn?Math.max(0,Math.round(Number(dn.value||0)*100)):0;
  if(dnCents>0){ 
    const sd=STATE.settings?.donations?.surcharge_donations ? surchargeOf(dnCents) : 0; 
    total += dnCents + sd; 
  }

  const el=document.getElementById('order-total'); 
  if(el) el.textContent=money(total);
}

async function checkout(){
  const purchaser={
    name:document.getElementById('p_name').value.trim(),
    title:document.getElementById('p_title').value.trim(),
    email:document.getElementById('p_email').value.trim(),
    phone:document.getElementById('p_phone').value.trim(),
    address:{
      line1:document.getElementById('p_addr1').value.trim(),
      line2:document.getElementById('p_addr2').value.trim(),
      city:document.getElementById('p_city').value.trim(),
      state:document.getElementById('p_state').value.trim(),
      postal_code:document.getElementById('p_zip').value.trim(),
      country:document.getElementById('p_country').value.trim()
    }
  };
  if(!purchaser.name||!purchaser.email||!purchaser.phone||!purchaser.address.line1||!purchaser.address.city||!purchaser.address.state||!purchaser.address.postal_code||!purchaser.address.country){
    alert('Please complete purchaser info.'); return;
  }
  const dn=document.getElementById('donation-amount'); 
  const extra_donation_cents=dn?Math.max(0,Math.round(Number(dn.value||0)*100)):0;

  // send store_notes so corsage style/custom can appear on Stripe (tiny API tweak needed)
  const body={ org:STATE.org, order:{ purchaser, attendees:STATE.attendees, store:STATE.store, store_notes:STATE.storeNotes, extra_donation_cents } };

  try{
    const res=await fetch('/api/create-checkout-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await res.json(); if(!d.url) throw new Error(d.error||'Checkout failed'); location.href=d.url;
  }catch(e){ alert(e.message); }
}

document.addEventListener('DOMContentLoaded',()=>{
  renderGroupHome();
  renderBanquets();
  renderDirectory();
  renderShop();
  renderOrder();
});

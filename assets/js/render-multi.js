async function getJSON(p){const r=await fetch(p,{cache:'no-store'});if(!r.ok) throw new Error('load '+p);return r.json();}
function money(c){return `$${(c/100).toFixed(2)}`;}
function currentOrg(){const m=location.pathname.match(/^\/([^\/]+)\//);return m?m[1]:'';}

/* ===== Banquet date formatting ===== */
function ordinal(n){
  const s=["th","st","nd","rd"], v=n%100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}
function formatBanquetDateTime(iso){
  if(!iso) return '';
  const d=new Date(iso);
  if(isNaN(d)) return '';
  const weekday = d.toLocaleDateString(undefined,{weekday:'long'});
  const month = d.toLocaleDateString(undefined,{month:'long'});
  const day = ordinal(d.getDate());
  let h=d.getHours(), m=d.getMinutes();
  const ampm = h>=12 ? 'PM' : 'AM';
  h = h%12; if(h===0) h=12;
  const time = m===0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2,'0')} ${ampm}`;
  return `${weekday}, ${month} ${day} at ${time}`;
}

/* ---- Simple Lightbox ---- */
function ensureLightbox(){
  if (document.getElementById('lightbox')) return;
  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = `
    <div class="lb-inner">
      <button class="lb-close" aria-label="Close">×</button>
      <img id="lightbox-img" alt="">
      <div id="lightbox-caption" class="lb-caption"></div>
    </div>`;
  document.body.appendChild(lb);
  lb.addEventListener('click', (e)=>{
    if (e.target.id === 'lightbox' || e.target.classList.contains('lb-close')) lb.classList.remove('open');
  });
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape') lb.classList.remove('open');});
}
function openLightbox(src, caption){
  ensureLightbox();
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  img.src = src;
  img.alt = caption || '';
  cap.textContent = caption || '';
  lb.classList.add('open');
}

/* ==== Cutoff helper ==== */
function getCutoffInfo(settings){
  const iso = settings?.orders?.cutoff_iso;
  if(!iso) return {active:false, date:null};
  const d=new Date(iso);
  if(isNaN(d)) return {active:false, date:null};
  return {active:(new Date()>d), date:d};
}

async function renderGroupHome(){
  const org=currentOrg();
  const homeBanquets=document.getElementById('home-banquets');
  const homeProducts=document.getElementById('home-products');
  if(homeBanquets){
    const banquets=await getJSON(`/data/${org}/banquets.json`);
    homeBanquets.innerHTML=(banquets.events||[]).slice(0,8).map(ev=>`
      <div class="card">
        <h3>${ev.title}</h3>
        <p>${formatBanquetDateTime(ev.datetime_iso)}</p>
        <p>${ev.venue||''}</p>
      </div>`).join('');
  }
  if(homeProducts){
    const products=await getJSON(`/data/${org}/products.json`);
    homeProducts.innerHTML=(products.items||[]).slice(0,3).map(p=>`
      <div class="card"><h3>${p.name}</h3><p>${p.description||''}</p><div class="price">${money(p.price_cents)}</div></div>`).join('');
  }
}

async function renderBanquets(){
  const org=currentOrg();
  const data=await getJSON(`/data/${org}/banquets.json`);
  const el=document.getElementById('banquet-list');
  if(el){el.innerHTML=(data.events||[]).map(ev=>`
    <div class="card">
      <h3>${ev.title}</h3>
      <p><strong>${formatBanquetDateTime(ev.datetime_iso)}</strong> — ${ev.venue||''}</p>
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
  if(!grid) return;
  const pickImage = (p) => p.image || p.image_url || p.img || (Array.isArray(p.images)&&p.images[0]) || '';
  grid.innerHTML = (data.items||[]).map(p=>{
    const imgSrc = pickImage(p);
    const imgBlock = imgSrc?`
      <button type="button" class="img-zoom" data-full="${imgSrc}" aria-label="View ${p.name}">
        <img src="${imgSrc}" alt="${p.name}" loading="lazy" style="max-width:100%;height:auto;border-radius:.75rem;">
      </button>`:'';
    return `<div class="card">${imgBlock}<h3 style="margin-top:.5rem;">${p.name}</h3><p>${p.description||''}</p><div class="price">${money(p.price_cents)}</div></div>`;
  }).join('');
  grid.addEventListener('click', e=>{
    const btn = e.target.closest('.img-zoom'); if(!btn) return;
    openLightbox(btn.getAttribute('data-full'), (btn.getAttribute('aria-label')||'').replace(/^View\s+/,''));});
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
  const cutoff=getCutoffInfo(settings);
  STATE={org, attendees:[], store:{}, storeNotes:{}, products, banquets, settings, cutoff};

  // Attendees (tickets/registration)
  const addBtn=document.getElementById('add-attendee');
  if(addBtn){
    if(cutoff.active){addBtn.disabled=true;addBtn.title='Ordering for tickets/registration is closed.';}
    else {addBtn.addEventListener('click', addAttendee); addAttendee();}
  }
  if(cutoff.active){
    const attWrap=document.getElementById('attendee-list');
    if(attWrap){const when=cutoff.date?cutoff.date.toLocaleString():'the cutoff date';
      attWrap.innerHTML=`<div class="card"><h3>Banquet tickets & registration</h3><p>Ordering closed as of <strong>${when}</strong>.</p></div>`;}
  }

  // Store (add-ons vs merchandise)
  const store=document.getElementById('store-list');
  if(store){
    const addonsHandles=new Set(['directory','corsage']); // add-ons closed after cutoff
    const items=products.items||[];
    const addons=cutoff.active?[]:items.filter(p=>addonsHandles.has(p.handle)&&p.handle!=='registration');
    const merch=items.filter(p=>!addonsHandles.has(p.handle)&&p.handle!=='registration');

    const renderItem=(p)=>{
      const q=STATE.store[p.handle]||0;
      const imgSrc=p.image||p.image_url||p.img||(Array.isArray(p.images)&&p.images[0])||'';
      const thumb=imgSrc?`<button type="button" class="img-zoom" data-full="${imgSrc}" aria-label="View ${p.name}"><img src="${imgSrc}" alt="${p.name}" loading="lazy" style="max-width:100%;height:auto;border-radius:.75rem;"></button>`:'';
      return `<div class="card">${thumb}<h3>${p.name}</h3><p>${p.description||''}</p><div class="price">${money(p.price_cents)}</div><label>Qty <input type="number" min="0" value="${q}" data-handle="${p.handle}" class="store-qty"></label></div>`;
    };

    const addonsHTML=addons.length
      ? addons.map(p => p.handle==='corsage' ? renderCorsage(p) : renderItem(p)).join('')
      : `<div class="tiny">Event add-ons ordering is closed${cutoff.date?` as of ${cutoff.date.toLocaleString()}`:''}.</div>`;

    const merchHTML=merch.map(renderItem).join('')||'<div class="tiny">No merchandise available.</div>';

    store.innerHTML=`<div class="store-sections">
      <section class="card store-addons"><h2>Event add-ons</h2><div class="grid-2">${addonsHTML}</div></section>
      <section class="card store-merch" style="margin-top:24px"><h2>Merchandise</h2><div class="grid-3">${merchHTML}</div></section>
    </div>`;

    document.querySelectorAll('.store-qty').forEach(inp=>{
      inp.addEventListener('input',e=>{
        const h=e.target.dataset.handle; const v=Math.max(0,Number(e.target.value||0));
        if(v===0) delete STATE.store[h]; else STATE.store[h]=v;
        updateTotal();
      });
    });
    store.addEventListener('click', e=>{
      const b=e.target.closest('.img-zoom'); if(!b) return;
      openLightbox(b.dataset.full,(b.ariaLabel||'').replace(/^View\s+/,''));});

    // If cutoff, purge add-on selections
    if(cutoff.active){ ['directory','corsage'].forEach(h=>{ delete STATE.store[h]; delete STATE.storeNotes[h]; }); }
  }

  // Donations
  const donateWrap=document.getElementById('extra-donation');
  if(donateWrap){
    if(settings.donations?.allow_extra_on_order && !cutoff.active){
      donateWrap.innerHTML=`<p>${settings.donations.purpose_text||''}</p>
        <div id="donation-quick"></div>
        <label>Custom amount (USD) <input type="number" id="donation-amount" min="0" step="1" value="${settings.donations.default_amount||0}"></label>`;
      const quick=donateWrap.querySelector('#donation-quick');
      if(quick){
        quick.innerHTML=(settings.donations.suggested||[]).map(v=>`<button class="btn" data-dn="${v}">$${v}</button>`).join(' ');
        quick.querySelectorAll('[data-dn]').forEach(b=>b.addEventListener('click',e=>{
          const val=Number(e.currentTarget.dataset.dn||0);
          const inp=document.getElementById('donation-amount'); if(inp) inp.value=val; updateTotal();
        }));
      }
      donateWrap.querySelector('#donation-amount')?.addEventListener('input', updateTotal);
    }else{
      const when=cutoff.date?cutoff.date.toLocaleString():'the cutoff date';
      donateWrap.innerHTML=`<div class="tiny">Donations closed as of <strong>${when}</strong>.</div>`;
    }
  }

  document.getElementById('checkout')?.addEventListener('click', checkout);
  updateTotal();
}

// Optional special renderer for corsage with style/custom note
function renderCorsage(p){
  const qty=STATE.store['corsage']||0;
  const note=STATE.storeNotes['corsage']||'';
  const presets=['Red Roses','Pink Roses','Yellow Roses','Spring Flowers'];
  const selected=presets.includes(note)?note:(note?'Custom':'Red Roses');
  const customText=(selected==='Custom' && !presets.includes(note))?note:'';
  const imgSrc = p.image || p.image_url || p.img || (Array.isArray(p.images)&&p.images[0]) || '';
  const thumb = imgSrc ? `<button type="button" class="img-zoom" data-full="${imgSrc}" aria-label="View ${p.name}">
      <img src="${imgSrc}" alt="${p.name}" loading="lazy" style="max-width:100%;height:auto;border-radius:.75rem;">
    </button>` : '';
  return `
    <div class="card">
      ${thumb}
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
}

function attendeeCard(i){
  const evs=STATE.banquets.events||[];
  const blocks=evs.map((ev,idx)=>{
    const tickets=(ev.tickets||[]).map(t=>`<option value="${t.handle}|${t.price_cents}">${ev.title} — ${t.label} — ${money(t.price_cents)}</option>`).join('');
    const meals=(ev.meals||[]).map(m=>`<option value="${m.code}">${m.label}</option>`).join('');
    return `<div class="card mt"><h4>${ev.title} — ${formatBanquetDateTime(ev.datetime_iso)}</h4>
      <div class="grid-3">
        <label>Ticket<select class="ticket" data-i="${i}" data-ev="${idx}"><option value="">-- none --</option>${tickets}</select></label>
        <label>Meal<select class="meal" data-i="${i}" data-ev="${idx}">${meals}</select></label>
        <label>Dietary<input type="text" class="diet" data-i="${i}" data-ev="${idx}" placeholder="e.g., gluten-free"></label>
      </div></div>`;
  }).join('');

  // Registration toggle per attendee
  const regPrice = regPriceCents();
  const regBlock = regPrice>0 ? `
    <div class="reg-box" data-i="${i}">
      <label style="display:flex;align-items:center;gap:.6rem;margin:0;">
        <input type="checkbox" class="a-register" data-i="${i}">
        <div>
          <div class="title">
            Register this attendee
            <span class="price-chip">${money(regPrice)}</span>
          </div>
          <div class="hint">Optional – adds a registration tied to this person’s name.</div>
        </div>
      </label>
    </div>` : '';

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
  if(STATE.cutoff?.active) return;
  document.getElementById('attendee-list').innerHTML=STATE.attendees.map((a,i)=>attendeeCard(i)).join('');
  bindAttendeeInputs();
}
function addAttendee(){ if(STATE.cutoff?.active) return; STATE.attendees.push({name:'',email:'',title:'',selections:[],registration:false}); renderAttendees(); }
function removeAttendee(i){ STATE.attendees.splice(i,1); renderAttendees(); updateTotal(); }

function bindAttendeeInputs(){
  if(STATE.cutoff?.active) return;
  document.querySelectorAll('.a-name').forEach(el=>el.addEventListener('input',e=>{STATE.attendees[e.target.dataset.i].name=e.target.value;}));
  document.querySelectorAll('.a-email').forEach(el=>el.addEventListener('input',e=>{STATE.attendees[e.target.dataset.i].email=e.target.value;}));
  document.querySelectorAll('.a-title').forEach(el=>el.addEventListener('input',e=>{STATE.attendees[e.target.dataset.i].title=e.target.value;}));
  document.querySelectorAll('.ticket').forEach(sel=>sel.addEventListener('change',e=>{
    const i=e.target.dataset.i,ev=e.target.dataset.ev;const [h,c]=e.target.value?e.target.value.split('|'):[null,0];
    if(!STATE.attendees[i].selections[ev]) STATE.attendees[i].selections[ev]={};
    STATE.attendees[i].selections[ev].handle=h; STATE.attendees[i].selections[ev].price_cents=Number(c||0); updateTotal();
  }));
  document.querySelectorAll('.meal').forEach(sel=>sel.addEventListener('change',e=>{
    const i=e.target.dataset.i,ev=e.target.dataset.ev;
    if(!STATE.attendees[i].selections[ev]) STATE.attendees[i].selections[ev]={};
    STATE.attendees[i].selections[ev].meal=e.target.value;
  }));
  document.querySelectorAll('.diet').forEach(inp=>inp.addEventListener('input',e=>{
    const i=e.target.dataset.i,ev=e.target.dataset.ev;
    if(!STATE.attendees[i].selections[ev]) STATE.attendees[i].selections[ev]={};
    STATE.attendees[i].selections[ev].dietary=e.target.value;
  }));
  document.querySelectorAll('.a-register').forEach(chk=>{
    const i=chk.dataset.i;
    chk.addEventListener('change',()=>{ STATE.attendees[i].registration=!!chk.checked; updateTotal(); });
  });
}

function updateTotal(){
  let total=0, feeTotal=0;
  const lines=[], pushLine=(label,cents)=>{lines.push(
    `<li class="line" style="display:flex;justify-content:space-between;gap:1rem;"><span>${label}</span><strong>${money(cents)}</strong></li>`
  );};

  // Tickets & registrations (skip after cutoff)
  if(!STATE.cutoff?.active){
    const evs=STATE.banquets.events||[];
    STATE.attendees.forEach(a=>{
      (a.selections||[]).forEach((sel, evIdx)=>{
        if(sel?.handle){
          const ev=evs[evIdx];
          const t=(ev?.tickets||[]).find(x=>x.handle===sel.handle);
          const base=Number(sel.price_cents||t?.price_cents||0), fee=surchargeOf(base), line=base+fee;
          total+=line; feeTotal+=fee;
          pushLine(`${a.name||'Attendee'} — ${ev?.title||'Event'} — ${t?.label||'Ticket'}`, line);
        }
      });
    });
    const regCents=regPriceCents();
    if(regCents>0){
      STATE.attendees.forEach(a=>{
        if(a.registration){
          const base=regCents, fee=surchargeOf(base), line=base+fee;
          total+=line; feeTotal+=fee;
          pushLine(`${a.name||'Attendee'} — Registration`, line);
        }
      });
    }
  }

  // Store items (skip add-ons after cutoff; keep merchandise)
  (STATE.products.items||[]).forEach(p=>{
    const isAddon=(p.handle==='directory'||p.handle==='corsage');
    if(STATE.cutoff?.active && isAddon) return;
    const q=Number(STATE.store[p.handle]||0);
    if(q>0){
      for(let i=0;i<q;i++){
        const base=Number(p.price_cents||0), fee=surchargeOf(base), line=base+fee;
        total+=line; feeTotal+=fee;
        let label=p.name;
        if(p.handle==='corsage' && STATE.storeNotes['corsage']) label += ` — ${STATE.storeNotes['corsage']}`;
        pushLine(label, line);
      }
    }
  });

  // Donations (skip after cutoff)
  const dn=document.getElementById('donation-amount');
  const dnCents=(dn && !STATE.cutoff?.active) ? Math.max(0,Math.round(Number(dn.value||0)*100)) : 0;
  if(dnCents>0){
    const fee=surchargeOf(dnCents), line=dnCents+fee;
    total+=line; feeTotal+=fee;
    pushLine('Extra Donation', line);
  }

  // Totals
  const totalEl=document.getElementById('order-total'); if(totalEl) totalEl.textContent=money(total);
  const linesEl=document.getElementById('order-lines');
  if(linesEl){
    linesEl.innerHTML = lines.length? `<ul style="list-style:none;padding:0;margin:.5rem 0 0 0;">${lines.join('')}</ul>`
                                   : `<div class="tiny">No items selected yet.</div>`;
  }
  const feesEl=document.getElementById('fees-line');
  if(feesEl){
    const s=STATE.settings?.surcharge||{};
    if(s.enabled && feeTotal>0) feesEl.innerHTML=`<strong>Fees added:</strong> ${money(feeTotal)} <span class="tiny">(card processing)</span>`;
    else if(s.enabled) feesEl.textContent='Fees added: $0.00';
    else feesEl.textContent='No card processing fee added to customer total.';
  }
}

async function checkout(){
  // Guard: if cutoff, block non-merch
  if(STATE.cutoff?.active){
    const hasAttendeeStuff=(STATE.attendees||[]).some(a=>{
      if(a.registration) return true;
      return (a.selections||[]).some(sel=>!!sel?.handle);
    });
    const hasAddons=['directory','corsage'].some(h=>(STATE.store[h]||0)>0);
    const dn=document.getElementById('donation-amount');
    const hasDonation = !!(dn && Number(dn.value||0)>0);
    if(hasAttendeeStuff || hasAddons || hasDonation){
      alert('Ordering for tickets, registration, add-ons, and donations is closed.');
      return;
    }
  }

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
  const extra_donation_cents=(!STATE.cutoff?.active && dn) ? Math.max(0,Math.round(Number(dn.value||0)*100)) : 0;

  const priceMap={}; (STATE.products.items||[]).forEach(p=>{priceMap[p.handle]=Number(p.price_cents||0);});

  const safeStore=Object.fromEntries(Object.entries(STATE.store||{}).filter(([h,v])=>{
    if(STATE.cutoff?.active && (h==='directory'||h==='corsage')) return false;
    return Number(v)>0;
  }));

  const body={ 
    org:STATE.org, 
    order:{ 
      purchaser, 
      attendees:STATE.cutoff?.active ? [] : STATE.attendees, 
      store:safeStore, 
      store_notes:STATE.cutoff?.active ? {} : STATE.storeNotes, 
      extra_donation_cents,
      store_price_cents_map: priceMap
    } 
  };

  try{
    const res=await fetch('/api/create-checkout-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await res.json(); if(!res.ok){ alert('Server error: '+(d.error||res.statusText)); return; }
    if(!d.url) throw new Error(d.error||'Checkout failed'); 
    location.href=d.url;
  }catch(e){ alert(e.message); }
}

document.addEventListener('DOMContentLoaded',()=>{
  const org=currentOrg();
  if (org) document.body.setAttribute('data-org', org);
  renderGroupHome();
  renderBanquets();
  renderDirectory();
  renderShop();
  renderOrder();
});

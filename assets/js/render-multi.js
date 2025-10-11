/* ===== utilities ===== */
async function getJSON(p){const r=await fetch(p,{cache:'no-store'});if(!r.ok) throw new Error('load '+p);return r.json();}
function money(c){return `$${(c/100).toFixed(2)}`;}
function currentOrg(){const m=location.pathname.match(/^\/([^\/]+)\//);return m?m[1]:'';}

/* ===== Banquet date formatting ===== */
function ordinal(n){const s=["th","st","nd","rd"], v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
function formatBanquetDateTime(iso){
  if(!iso) return '';
  const d=new Date(iso); if(isNaN(d)) return '';
  const weekday=d.toLocaleDateString(undefined,{weekday:'long'});
  const month=d.toLocaleDateString(undefined,{month:'long'});
  const day=ordinal(d.getDate());
  let h=d.getHours(), m=d.getMinutes();
  const ampm=h>=12?'PM':'AM'; h=h%12; if(h===0) h=12;
  const time=m===0?`${h} ${ampm}`:`${h}:${String(m).padStart(2,'0')} ${ampm}`;
  return `${weekday}, ${month} ${day} at ${time}`;
}

/* ===== simple lightbox ===== */
function ensureLightbox(){
  if(document.getElementById('lightbox')) return;
  const lb=document.createElement('div');
  lb.id='lightbox';
  lb.innerHTML=`
    <div class="lb-inner">
      <button class="lb-close" aria-label="Close">×</button>
      <img id="lightbox-img" alt="">
      <div id="lightbox-caption" class="lb-caption"></div>
    </div>`;
  document.body.appendChild(lb);
  lb.addEventListener('click',e=>{ if(e.target.id==='lightbox'||e.target.classList.contains('lb-close')) lb.classList.remove('open'); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') lb.classList.remove('open'); });
}
function openLightbox(src,caption){
  ensureLightbox();
  const lb=document.getElementById('lightbox');
  const img=document.getElementById('lightbox-img');
  const cap=document.getElementById('lightbox-caption');
  img.src=src; img.alt=caption||''; cap.textContent=caption||''; lb.classList.add('open');
}

/* ===== home widgets (MODIFIED TO DO NOTHING) ===== */
async function renderGroupHome(){
  // All code that loads and renders banquets/items on the home page has been removed 
  // to stop content from appearing on the main page.
  return; 
}

async function renderBanquets(){
  const org=currentOrg();
  try {
    const data=await getJSON(`/data/${org}/banquets.json`);
    const el=document.getElementById('banquet-list');
    if(el){
      el.innerHTML=(data.events||[]).map(ev=>`
        <div class="card">
          <h3>${ev.title}</h3>
          <p><strong>${formatBanquetDateTime(ev.datetime_iso)}</strong> — ${ev.venue||''}</p>
          ${(ev.tickets||[]).map(t=>`<div class="mt">${t.label} — ${money(t.price_cents)}</div>`).join('')}
          <p class="tiny">Meals: ${(ev.meals||[]).map(m=>m.label).join(', ')}</p>
      </div>`).join('');
    }
  } catch (e) {
    console.error("Could not load main banquets data (likely 404).", e);
  }
}

async function renderDirectory(){
  const org=currentOrg();
  const el=document.getElementById('directory-info');
  if(!el) return;
  try {
    const s=await getJSON(`/data/${org}/settings.json`);
    el.textContent=s.directory?.blurb||'Purchase a printed directory via the Order page.';
  } catch (e) {
    console.error("Could not load directory settings data (likely 404).", e);
  }
}

async function renderShop(){
  const org=currentOrg();
  try {
    const data=await getJSON(`/data/${org}/products.json`);
    const grid=document.getElementById('product-grid');
    if(!grid) return;

    const pickImage=p=>p.image||p.image_url||p.img||(Array.isArray(p.images)&&p.images[0])||'';

    const cards=(data.items||[]).map(p=>{
      const imgSrc=pickImage(p);
      const imgBlock=imgSrc?`
        <button type="button" class="img-zoom" data-full="${imgSrc}" aria-label="View ${p.name}">
          <img src="${imgSrc}" alt="${p.name}" loading="lazy" style="max-width:100%;height:auto;border-radius:.75rem;">
        </button>`:'';
      return `
        <div class="card">
          ${imgBlock}
          <h3 style="margin-top:.5rem;">${p.name}</h3>
          <p>${p.description||''}</p>
          <div class="price">${money(p.price_cents)}</div>
        </div>`;
    }).join('');

    grid.innerHTML=cards;

    grid.addEventListener('click',e=>{
      const btn=e.target.closest('.img-zoom'); if(!btn) return;
      const full=btn.getAttribute('data-full'); const label=btn.getAttribute('aria-label')||'';
      if(full) openLightbox(full,label.replace(/^View\s+/,''));
    });
  } catch (e) {
    console.error("Could not load shop products data (likely 404).", e);
  }
}

/* ===== ORDER ===== */
let STATE=null;

function surchargeOf(base){
  const s=STATE?.settings?.surcharge||{};
  const P=Number(s.fee_percent||0), F=Number(s.fee_fixed_cents||0), CAP=Number(s.cap_percent||0);
  if(!s.enabled||(P<=0&&F<=0)) return 0;
  const gross=Math.ceil((base+F)/(1-P));
  let sur=gross-base;
  if(CAP>0){const capPct=Math.floor(base*CAP); if(sur>capPct) sur=capPct;}
  return sur;
}

function regPriceCents(){
  const p=(STATE?.products?.items||[]).find(x=>x.handle==='registration');
  return p?Number(p.price_cents||0):0;
}

async function renderOrder(){
  /* FIX: guard so running this on non-order pages doesn’t crash */
  const hasOrderUI = document.getElementById('attendee-list') ||
                     document.getElementById('store-list') ||
                     document.getElementById('checkout');
  if(!hasOrderUI) return;

  const org=currentOrg(); if(!org) return;

  try {
    const [products,banquets,settings]=await Promise.all([
      getJSON(`/data/${org}/products.json`),
      getJSON(`/data/${org}/banquets.json`),
      getJSON(`/data/${org}/settings.json`)
    ]);
    STATE={org, attendees:[], store:{}, storeNotes:{}, products, banquets, settings};
  } catch (e) {
    console.error("Could not load order page data.", e);
    return; // Prevent crashing the rest of the logic if data fails to load
  }

  const addBtn=document.getElementById('add-attendee');
  if(addBtn) addBtn.addEventListener('click', addAttendee);

  /* FIX: only seed an attendee if the container exists */
  if(document.getElementById('attendee-list')) addAttendee();

  const store=document.getElementById('store-list');
  if(store){
    const addonsHandles=new Set(['directory','corsage']);
    const items=(STATE.products.items||[]);
    const addons=items.filter(p=>addonsHandles.has(p.handle)&&p.handle!=='registration');
    const merch =items.filter(p=>!addonsHandles.has(p.handle)&&p.handle!=='registration');

    const pickImage=p=>p.image||p.image_url||p.img||(Array.isArray(p.images)&&p.images[0])||'';
    const renderItem=p=>{
      const q=STATE.store[p.handle]||0;
      const imgSrc=pickImage(p);
      const thumb=imgSrc?`
        <button type="button" class="img-zoom" data-full="${imgSrc}" aria-label="View ${p.name}">
          <img src="${imgSrc}" alt="${p.name}" loading="lazy" style="max-width:100%;height:auto;border-radius:.75rem;">
        </button>`:'';
      return `
        <div class="card">
          ${thumb}
          <h3>${p.name}</h3>
          <p>${p.description||''}</p>
          <div class="price">${money(p.price_cents)}</div>
          <label>Qty <input type="number" min="0" value="${q}" data-handle="${p.handle}" class="store-qty"></label>
        </div>`;
    };

    const renderCorsage=p=>{
      const qty=STATE.store['corsage']||0;
      const note=STATE.storeNotes['cors
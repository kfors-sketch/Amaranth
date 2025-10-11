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

/* ===== home widgets ===== */
async function renderGroupHome(){
  const org=currentOrg();
  const homeBanquets=document.getElementById('home-banquets');
  const homeProducts=document.getElementById('home-products');

  // --- START FIX: Add try/catch for robust data loading ---
  try {
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
        <div class="card">
          <h3>${p.name}</h3>
          <p>${p.description||''}</p>
          <div class="price">${money(p.price_cents)}</div>
        </div>`).join('');
    }
  } catch(e) {
    // This will now log any fetch or JSON parsing errors to your browser console
    console.error('Error loading home widget data:', e.message);
    if(homeBanquets) homeBanquets.innerHTML = `<div class="tiny">Error loading banquets: ${e.message}</div>`;
    if(homeProducts) homeProducts.innerHTML = `<div class="tiny">Error loading products: ${e.message}</div>`;
  }
  // --- END FIX ---
}

async function renderBanquets(){
  const org=currentOrg();
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
}

async function renderDirectory(){
  const org=currentOrg();
  const el=document.getElementById('directory-info');
  if(!el) return;
  const s=await getJSON(`/data/${org}/settings.json`);
  el.textContent=s.directory?.blurb||'Purchase a printed directory via the Order page.';
}

async function renderShop(){
  const org=currentOrg();
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
    const btn=e.target.closest('.img-zoom'); if(!btn)
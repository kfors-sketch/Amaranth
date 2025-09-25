document.addEventListener('DOMContentLoaded',()=>{
  const navToggle=document.getElementById('navToggle');const nav=document.getElementById('nav');
  if(navToggle){navToggle.addEventListener('click',()=>{const ex=navToggle.getAttribute('aria-expanded')==='true';navToggle.setAttribute('aria-expanded',(!ex).toString());nav.classList.toggle('show');});}
});
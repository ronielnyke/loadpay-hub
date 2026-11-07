(() => {
'use strict';
const C = window.APP_CONFIG;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const peso = n => '\u20B1' + Number(n).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtDate = t => new Date(t).toLocaleString('en-US', {month:'short', day:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
const isSet = v => !!v && !/^YOUR_/i.test(v);
const okPhone = v => /^09\d{9}$/.test(v || '');
const fbOn = isSet(C.firebase.apiKey);
let actMailOn = false, mailOn = false;
function refreshMail() {
  actMailOn = isSet(C.emailjs.publicKey) && isSet(C.emailjs.serviceId) && isSet(C.emailjs.activationTemplateId);
  mailOn = isSet(C.emailjs.publicKey) && isSet(C.emailjs.serviceId) && isSet(C.emailjs.templateId);
}
refreshMail();

let auth, db, user = null;
const S = {sel:new Set(), selMode:false, view:'login', stack:[], flow:{}, mode:'in', txs:[], last:null, page:1, f:{svc:'', pay:'', q:''}, rc:null};
if (fbOn) { firebase.initializeApp(C.firebase); auth = firebase.auth(); db = firebase.firestore(); db.settings({experimentalAutoDetectLongPolling:true, merge:true}); }
const _ld = {};
const lazy = u => _ld[u] || (_ld[u] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = () => { delete _ld[u]; rej(new Error('Could not load ' + u)); }; document.head.appendChild(s); }));
const MAIL_JS = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js', H2C_JS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
let mailInit = false;
async function loadMail() { await lazy(MAIL_JS); if (!mailInit) { emailjs.init({publicKey: C.emailjs.publicKey}); mailInit = true; } }

const TO = (p, ms = 12000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('Request timed out. Please check your internet connection.')), ms))]);
const diag = e => {
  const c = (e && e.code) || '', m = (e && e.message) || '';
  if (c === 'permission-denied') return 'Database permission denied. Firebase Console > Firestore Database > Rules: paste the rules from README.md and click Publish.';
  if (c === 'unavailable' || c === 'failed-precondition' || /timed out/i.test(m)) return 'Cannot reach the database. In Firebase Console open Build > Firestore Database and click "Create database", then publish the rules from README.md. Also turn off ad-blockers/VPN and refresh.';
  return m || 'Something went wrong. Please try again.';
};
const ACH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() { const b = new Uint32Array(8); crypto.getRandomValues(b); const s = [...b].map(x => ACH[x % ACH.length]).join(''); return s.slice(0, 4) + '-' + s.slice(4); }
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const CODE_ALIASES = ['code', 'activation_code', 'activation_key', 'activationCode', 'activationKey', 'activation_key_code', 'key', 'otp', 'OTP', 'verification_code', 'verify_code', 'passcode', 'pin', 'token', 'auth_code', 'access_code', 'license_key', 'user_code'];
// The key is sent under many common variable names so it shows up whatever name the EmailJS template uses.
function actParams(email, name, code) {
  const p = {to_email:email, email, user_email:email, to_name:name || email, name:name || email, user_name:name || email, app_name:'LoadPay Hub', site_url:(typeof location !== 'undefined' && location.origin) || '', subject:'Your LoadPay Hub activation key', message:'Your LoadPay Hub activation key is: ' + code};
  CODE_ALIASES.forEach(k => { p[k] = code; });
  return p;
}
const ACT_TPL = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
<div style="background:#0b2a6f;padding:24px;text-align:center"><img src="${(typeof location !== 'undefined' && location.origin) || ''}/img/logo-192.png" width="72" height="72" alt="LoadPay Hub" style="border-radius:50%;border:3px solid #ffffff"><div style="color:#ffffff;font-size:20px;font-weight:800;margin-top:8px">LoadPay Hub</div></div>
<div style="padding:24px"><h2 style="margin:0 0 8px;color:#0f172a">Hello, {{to_name}}!</h2>
<p style="color:#475569;font-size:15px">Use this activation key to activate your account:</p>
<div style="text-align:center;margin:20px 0"><span style="display:inline-block;background:#eef4ff;border:2px dashed #0b5ed7;border-radius:12px;padding:14px 26px;font-size:30px;letter-spacing:6px;font-weight:800;color:#0b5ed7;font-family:Courier New,monospace">{{code}}</span></div>
<p style="color:#475569;font-size:13px">Open LoadPay Hub, then paste this key on the Activate screen. It expires in 24 hours and works once.</p>
<p style="color:#94a3b8;font-size:12px">Never share this key. If you did not request it, ignore this email.</p></div></div>`;
async function sendCode(u, name) {
  const ref = db.collection('activations').doc(u.uid), snap = await TO(ref.get());
  if (snap.exists && snap.data().activated) return;
  let code, hash, ok = false;
  for (let i = 0; i < 6 && !ok; i++) {            // every key is unique across ALL accounts
    code = genCode(); hash = await sha(code.replace('-', ''));
    try { await TO(db.collection('activationKeys').doc(hash).set({uid:u.uid, ts:Date.now()})); ok = true; }
    catch (e) { if (e.code !== 'permission-denied' || i === 5) throw e; }   // key already exists -> make a new one
  }
  if (snap.exists && snap.data().hash) db.collection('activationKeys').doc(snap.data().hash).delete().catch(() => {});
  const d = {email:u.email, hash, exp:Date.now() + 864e5, ts:Date.now()};
  if (snap.exists) await TO(ref.update(d)); else await TO(ref.set({...d, activated:false}));
  await loadMail();
  await emailjs.send(C.emailjs.serviceId, C.emailjs.activationTemplateId, actParams(u.email, name, code));
}
const actErr = e => ({BADKEY:'Wrong activation key. Check the email and try again.', EXPIRED:'This key expired. Tap "Send a new key".', NOKEY:'No activation key found. Tap "Send a new key".'}[e.message] || diag(e));
const OKSVG = '<svg class="ok" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/><path d="M28 52l16 16 29-33"/></svg>';
function startWatch() {
  if (!db || S.unsub) return;
  let first = true;
  S.unsub = db.collection('transactions').onSnapshot(s => {
    S.txs = s.docs.map(d => d.data()).sort((x, y) => y.ts - x.ts);
    if (!first) s.docChanges().forEach(c => { if (c.type === 'added') { const d = c.doc.data(); toast('New order: ' + d.service + ' ' + peso(d.amount), 'primary'); beep(); } });
    first = false; if (S.view === 'admin') drawAdmin();
  }, e => console.error('watch', e));
}
function stopWatch() { if (S.unsub) { S.unsub(); S.unsub = null; } }
function beep() { try { const A = window.AudioContext || window.webkitAudioContext, c = new A(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.setValueAtTime(.08, c.currentTime); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .4); o.start(); o.stop(c.currentTime + .4); } catch (e) {} }

/* ----- PayMongo (via Netlify Functions) ----- */
async function fn(name, body) {
  const t = await auth.currentUser.getIdToken();
  const r = await TO(fetch('/.netlify/functions/' + name, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...body, idToken:t})}), 25000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Server error (' + r.status + ')');
  return j;
}
async function checkPM() {
  try { const r = await TO(fetch('/.netlify/functions/pm-status'), 5000), j = await r.json(); PM.ok = !!j.ok; PM.mode = j.mode || 'test'; } catch (e) { PM.ok = false; }
}
async function paidMail(t) {
  const m = await sendReceipt(t, `LoadPay Hub payment confirmed \u2013 ${t.id}`);
  if (m === 'ok') toast('Receipt emailed to ' + t.email, 'success');
}
async function handlePmReturn() {
  let r = null; try { r = JSON.parse(sessionStorage.getItem('lph_pmret') || 'null'); } catch (e) {}
  if (!r) return; sessionStorage.removeItem('lph_pmret');
  if (r.pm !== 'ok') return toast('Payment cancelled. You can try again from the banner on Home.', 'warning');
  busy(true, 'Confirming your payment\u2026');
  let res = null;
  for (let i = 0; i < 4; i++) {
    try { res = await fn('pm-verify', {txId:r.tx}); if (res.paid) break; } catch (e) { console.error(e); res = {error:e.message}; }
    await new Promise(x => setTimeout(x, 2500));
  }
  busy(false); await fetchTx();
  const t = S.txs.find(x => x.id === r.tx);
  if (t) { S.last = t; S.stack = ['home']; S.view = 'done'; render(); window.scrollTo({top:0}); }
  if (res && res.paid) { if (res.changed && t) paidMail(t); }
  else toast('We have not received the payment confirmation yet. Tap "I\'ve paid \u2013 check status" in a moment.', 'warning');
}
function readCat() {
  const g = s => $(s), E = S.E;
  if (g('#ceLoad')) E.loadAmounts = [...new Set((g('#ceLoad').value || '').split(/[,\s]+/).map(Number).filter(x => x >= 1 && x <= 1000))].sort((x, y) => x - y);
  Object.keys(CATS).forEach(k => { const t = g('#ceB-' + k.replace(/\W/g, '')); if (t) E.billers[k] = t.value.split('\n').map(s => s.trim()).filter(Boolean); });
  if (g('#cfL')) E.fees = {load:Math.max(0, +g('#cfL').value || 0), data:Math.max(0, +g('#cfD').value || 0), bill:Math.max(0, +g('#cfB').value || 0)};
  ['Cash', 'GCash', 'Maya', 'GrabPay', 'Card'].forEach(m => { const c = g('#cm-' + m); if (c) E.methods[m] = !!c.checked; });
}
function drawCatEd() {
  const el = $('#catEd'); if (!el || !S.E) return;
  const E = S.E, n = S.ceNet || 'smart', list = E.promos[n] || (E.promos[n] = []);
  const inp = (v, h, on, t = 'text') => `<input type="${t}" class="form-control" value="${esc(v)}" ${h} oninput="${on}">`;
  el.innerHTML = `<div class="stat mb-3"><b><i class="bi bi-wifi"></i> Data Promos</b>
<div class="d-flex flex-wrap gap-2 my-2">${NETS.map(x => `<button class="btn btn-sm ${x.id === n ? 'btn-primary' : 'btn-outline-primary'}" onclick="LP.ceNet('${x.id}')">${x.name}</button>`).join('')}</div>
${list.map((p, i) => `<div class="row g-2 mb-2 align-items-center"><div class="col-12 col-md-3">${inp(p.name, 'placeholder="Promo name"', `LP.cp(${i},'name',this.value)`)}</div><div class="col-12 col-md-4">${inp(p.sub, 'placeholder="Description / validity"', `LP.cp(${i},'sub',this.value)`)}</div><div class="col-5 col-md-2">${inp(p.code || '', 'placeholder="Promo code"', `LP.cp(${i},'code',this.value)`)}</div><div class="col-4 col-md-2">${inp(p.price, 'min="1" placeholder="Price"', `LP.cp(${i},'price',this.value)`, 'number')}</div><div class="col-3 col-md-1"><button class="btn btn-outline-danger btn-sm" onclick="LP.cdel(${i})"><i class="bi bi-trash"></i></button></div></div>`).join('') || '<div class="text-secondary small mb-2">No promos for this network yet.</div>'}
<button class="btn btn-outline-primary btn-sm" onclick="LP.cadd()"><i class="bi bi-plus-lg"></i> Add promo</button> <button class="btn btn-outline-secondary btn-sm" onclick="LP.cdef()"><i class="bi bi-arrow-counterclockwise"></i> Load real PH promos</button><p class="small text-secondary mt-2 mb-0">Prices and inclusions change often. Check them against your supplier, then press Save at the bottom.</p></div>
<div class="stat mb-3"><b><i class="bi bi-phone"></i> Load Amounts (\u20B1, separated by commas)</b><input id="ceLoad" class="form-control mt-2" value="${esc(E.loadAmounts.join(', '))}"></div>
<div class="stat mb-3"><b><i class="bi bi-receipt"></i> Billers (one per line)</b><div class="row g-2 mt-1">${Object.keys(CATS).map(k => `<div class="col-md-6"><label class="lbl mt-0">${k}</label><textarea id="ceB-${k.replace(/\W/g, '')}" rows="4" class="form-control">${esc((E.billers[k] || CATS[k].b).join('\n'))}</textarea></div>`).join('')}</div></div>
<div class="stat mb-3"><b><i class="bi bi-cash-coin"></i> Service fee added to each order (\u20B1)</b><div class="row g-2 mt-1"><div class="col-4"><label class="lbl mt-0">Load</label><input id="cfL" type="number" min="0" class="form-control" value="${E.fees.load}"></div><div class="col-4"><label class="lbl mt-0">Data</label><input id="cfD" type="number" min="0" class="form-control" value="${E.fees.data}"></div><div class="col-4"><label class="lbl mt-0">Bills</label><input id="cfB" type="number" min="0" class="form-control" value="${E.fees.bill}"></div></div></div>
<div class="stat mb-3"><b><i class="bi bi-credit-card"></i> Payment methods customers can use</b><div class="d-flex flex-wrap gap-3 mt-2">${['Cash', 'GCash', 'Maya', 'GrabPay', 'Card'].map(m => `<label class="form-check"><input class="form-check-input" type="checkbox" id="cm-${m}" ${E.methods[m] !== false ? 'checked' : ''}> <span class="form-check-label">${m}</span></label>`).join('')}</div></div>
<button class="btn btn-primary btn-lg" onclick="LP.saveCat()"><i class="bi bi-save"></i> Save Prices & Catalog</button>`;
}
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|TikTok|Snapchat|MicroMessenger|Twitter|; wv\)/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
const inAppBanner = () => IN_APP ? `<div class="alert alert-warning small d-flex gap-2"><i class="bi bi-exclamation-triangle-fill"></i><div><b>Open in your browser to use Google sign-in.</b> Messenger / Facebook's built-in browser blocks Google login. Tap <b>\u22EF</b> then <b>Open in Chrome / Safari</b>, or sign in with email and password below.<div class="mt-2 d-flex gap-2 flex-wrap"><button type="button" class="btn btn-sm btn-primary" onclick="LP.openExt()">Open in browser</button><button type="button" class="btn btn-sm btn-outline-primary" onclick="LP.copy(location.origin, 'Link copied! Paste it in Chrome or Safari.')">Copy link</button></div></div></div>` : '';
async function markActivated() {
  const ref = db.collection('activations').doc(user.uid), s = await TO(ref.get());
  if (!s.exists) await TO(ref.set({email:user.email, hash:'', exp:0, ts:Date.now(), activated:false}));
  await TO(ref.update({activated:true, activatedAt:Date.now()}));
  localStorage.setItem('lph_act_' + user.uid, '1');
}
function showDbWarn() { const w = $('#dbwarn'); if (w) w.innerHTML = S.dbErr ? `<div class="alert alert-danger d-flex gap-2 anim"><i class="bi bi-exclamation-triangle-fill"></i><div class="small">${esc(S.dbErr)}</div></div>` : ''; }
const isOwner = () => !!user && !!C.owner && user.email.toLowerCase() === C.owner.email.toLowerCase() && isAdmin();
const isAdmin = () => !!user && (!fbOn || (user.verified && C.adminEmails.some(e => e.toLowerCase() === (user.email || '').toLowerCase())));

/* ---------- Payment settings (editable by operator, shared via Firestore) ---------- */
const PAY = {gcash:{...C.gcash}, maya:{...C.maya}};
async function loadPay() {
  try {
    let d = null, c = null;
    if (db) {
      const [s1, s2] = await Promise.all([TO(db.collection('settings').doc('payment').get(), 6000), TO(db.collection('settings').doc('catalog').get(), 6000)]);
      d = s1.exists ? s1.data() : null; c = s2.exists ? s2.data() : null;
    } else { d = JSON.parse(localStorage.getItem('lph_pay') || 'null'); c = JSON.parse(localStorage.getItem('lph_cat') || 'null'); }
    if (d) { Object.assign(PAY.gcash, d.gcash || {}); Object.assign(PAY.maya, d.maya || {}); }
    if (c) ['loadAmounts', 'promos', 'billers', 'fees', 'methods'].forEach(k => { if (c[k]) CAT[k] = c[k]; });
    S.dbErr = null; showDbWarn();
  } catch (e) { console.error('Settings load failed', e); S.dbErr = diag(e) + ' [settings: ' + (e.code || 'error') + ']'; showDbWarn(); }
  if (fbOn) checkPM();
}

/* ---------- UI helpers ---------- */
function toast(m, t = 'primary') {
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${t} border-0 shadow`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body fw-medium">${esc(m)}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  $('#toasts').appendChild(el);
  el.addEventListener('hidden.bs.toast', () => el.remove());
  new bootstrap.Toast(el, {delay: 4000}).show();
}
let ldT = null;
const LD_MSGS = ['Securing your session\u2026', 'Syncing your data\u2026', 'Almost there\u2026'];
function busy(on, msg) {
  const l = $('#loader'), m = $('#ldMsg');
  l.classList.toggle('hide', !on); clearInterval(ldT); ldT = null;
  if (!on) return;
  if (msg) { if (m) m.textContent = msg; return; }
  let i = 0; if (m) m.textContent = LD_MSGS[0];
  ldT = setInterval(() => { i = (i + 1) % LD_MSGS.length; if (m) m.textContent = LD_MSGS[i]; }, 1600);
}

/* ---------- Data ---------- */
const NETS = [['smart','Smart','#16a34a'],['globe','Globe','#2563eb'],['dito','DITO','#dc2626'],['tnt','TNT','#f59e0b'],['sun','Sun','#f97316']].map(([id,name,color]) => ({id,name,color}));
const net = id => NETS.find(n => n.id === id) || NETS[0];
const PB = [['5GB','Unli All Net Texts','3 Days',50],['10GB','Unli All Net Texts','7 Days',99],['15GB','Unli All Net Texts','7 Days',149],['20GB','Unli All Net Texts','30 Days',299]];
const REAL = {
  globe:[['Go59','5GB all-access + 1GB 5G \u2022 Unli all-net texts \u2022 3 days',59,'GO59'],['GoEXTRA59','5GB all-access \u2022 Unli all-net calls & texts \u2022 3 days',59,'GOEXTRA59'],['Go+99','20GB (8GB all sites + 8GB apps + 4GB 5G) \u2022 Unli all-net texts \u2022 7 days',99,'GOPLUS99'],['GoEXTRA99','9GB shareable all-access \u2022 Unli calls & texts \u2022 7 days',99,'GOEXTRA99'],['Go+129','10GB all-access + 8GB apps \u2022 Unli all-net texts \u2022 Unli calls to Globe/TM \u2022 7 days',129,'GOPLUS129'],['SURF4ALL249','20GB shareable all-access \u2022 7 days',249,'SURF4ALL249']],
  smart:[['All Data 50','2GB all-access \u2022 3 days',50,'*123# > ALL DATA 50'],['Giga Video 99','2GB all-access + 1GB/day for video apps \u2022 7 days',99,'GIGA99'],['All Data 99','6GB all-access \u2022 7 days',99,'*123# > ALL DATA 99'],['Power All 99','8GB shareable all-access + Unli TikTok \u2022 7 days',99,'*123# > POWER ALL 99'],['Power All 149','12GB all-access \u2022 7 days',149,'*123# > POWER ALL 149'],['Magic Data 99','2GB all-access \u2022 No expiry',99,'*123# > MAGIC DATA 99'],['Magic Data 199','6GB all-access \u2022 No expiry',199,'*123# > MAGIC DATA 199'],['All Data 299','24GB all-access \u2022 30 days',299,'*123# > ALL DATA 299'],['Giga Video 299','4GB all-access + 1GB/day for video apps \u2022 30 days',299,'GIGA299']],
  dito:[['Level-Up 99','Open-access data \u2022 Unli all-net texts \u2022 Unli DITO calls + 300 mins other networks \u2022 30 days',99,'LEVEL-UP 99'],['Unli 5G 299','Unli 5G data \u2022 Unli texts \u2022 Unli DITO calls + 300 mins other networks \u2022 7 days',299,'UNLI 5G 299'],['Unli 5G 499','Unli 5G data \u2022 Unli texts \u2022 Unli DITO calls + 300 mins other networks \u2022 15 days',499,'UNLI 5G 499'],['Unli 5G 999','Unli 5G data \u2022 Unli texts \u2022 Unli DITO calls + 300 mins other networks \u2022 30 days',999,'UNLI 5G 999']],
  tnt:[['All Data 50','2GB+ shareable open-access data \u2022 50 all-net texts \u2022 5 mins all-net calls \u2022 3 days',50,'*123# > ALL DATA 50'],['Giga 99','2GB all-access + 1GB/day for video apps \u2022 7 days',99,'GIGA99'],['Giga 299','4GB all-access + 1GB/day for video apps \u2022 30 days',299,'GIGA299'],['Giga 399','6GB all-access + 1GB/day for video apps \u2022 30 days',399,'GIGA399']],
  sun:[['Giga 99','2GB all-access + 1GB/day for video apps \u2022 7 days',99,'GIGA99'],['Giga 299','4GB all-access + 1GB/day for video apps \u2022 30 days',299,'GIGA299'],['Giga 399','6GB all-access + 1GB/day for video apps \u2022 30 days',399,'GIGA399']]
};
const promosFrom = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.map(p => ({name:p[0], sub:p[1], price:p[2], code:p[3] || ''}))]));
const CATS = {
  'Electricity':{i:'lightning-charge-fill', b:['MERALCO','MORE Power','VECO','ILECO','Other Electric Cooperatives']},
  'Water':{i:'droplet-fill', b:['Maynilad','Manila Water','Metro Iloilo Water District','Other Water Districts']},
  'Internet':{i:'wifi', b:['PLDT Home','Converge','Globe At Home','Sky Cable']},
  'Credit Card':{i:'credit-card-2-front-fill', b:['BPI','BDO','Metrobank','Other Banks']},
  'Government':{i:'bank2', b:['SSS','PhilHealth','Pag-IBIG','BIR','NBI / Police Clearance']},
  'E-Wallet':{i:'wallet2', b:['GCash Cash-In','Maya Cash-In','ShopeePay Cash-In']},
  'Others':{i:'three-dots', b:['Insurance','School Fees','Loan Payment','Other Biller']}
};
const TILES = [['Buy Load','phone-fill','load'],['Data Promos','wifi','data'],['Bills Payment','receipt','bill'],['E-Wallet','wallet2','bill','E-Wallet'],['Government Fees','bank2','bill','Government'],['Others','three-dots','bill','Others']];
const WHY = [['phone','Multi-Network Load','Smart, Globe, DITO, TNT, Sun'],['wifi','Data Promos','3G, 4G and 5G promos'],['receipt','Bills Payment','Electricity, water, internet and more'],['wallet2','E-Wallet','GCash and Maya cash-in'],['bank2','Government Fees','SSS, PhilHealth, Pag-IBIG'],['clock-history','24/7 Access','Pay anytime, anywhere'],['shield-check','Secure & Reliable','Every transaction is recorded'],['people','Income Opportunity','Agent / franchise model']];
const VIEW = {load:'load', data:'data', bill:'bills'};
const newFlow = (type, cat) => ({type, net:'smart', amount:0, mobile:'', promo:null, cat:cat || null, biller:null, account:'', name:'', method:'Cash', ref:''});
const DEF_CAT = {loadAmounts:[10,20,30,50,100,200,300,500], promos:promosFrom(REAL), billers:Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, [...v.b]])), fees:{load:0, data:0, bill:0}, methods:{Cash:true, GCash:true, Maya:true, GrabPay:true, Card:true}};
const CAT = JSON.parse(JSON.stringify(DEF_CAT));
const promos = id => CAT.promos[id] || [];
const billersOf = k => (CAT.billers && CAT.billers[k]) || CATS[k].b;
const PM = {ok:false, mode:'test'};
const ONLINE = {GCash:['gcash','phone-fill','Pay instantly in the GCash app'], Maya:['paymaya','credit-card-2-front','Pay with Maya'], GrabPay:['grab_pay','car-front-fill','Pay with GrabPay'], Card:['card','credit-card','Visa / Mastercard']};

/* ---------- Storage (Firestore, or localStorage when Firebase is not configured) ---------- */
const Store = {
  _l() { try { return JSON.parse(localStorage.getItem('lph_tx') || '[]'); } catch (e) { return []; } },
  async add(t) {
    if (db) await TO(db.collection('transactions').doc(t.id).set(t));
    else { const l = this._l(); l.push(t); localStorage.setItem('lph_tx', JSON.stringify(l)); }
  },
  async list() {
    let r;
    if (db) {
      const c = db.collection('transactions');
      const s = await TO((isAdmin() ? c : c.where('uid', '==', user.uid)).get());
      r = s.docs.map(d => d.data());
    } else r = this._l().filter(x => isAdmin() || x.uid === user.uid);
    if (!isAdmin()) r = r.filter(t => !t.hidden);
    return r.sort((a, b) => b.ts - a.ts);
  },
  copyTpl() { LP.copy(ACT_TPL, 'Template copied! In EmailJS open your Activation template > Edit Content > code view > paste > Save.'); },
  async fulfill(id) {
    if (db) await TO(db.collection('transactions').doc(id).update({fulfilled:true, fulfilledAt:Date.now(), updated:Date.now()}));
    else { const l = this._l(); const t = l.find(x => x.id === id); if (t) t.fulfilled = true; localStorage.setItem('lph_tx', JSON.stringify(l)); }
  },
  async hide(ids) {
    if (db) { for (let i = 0; i < ids.length; i += 400) { const b = db.batch(); ids.slice(i, i + 400).forEach(id => b.update(db.collection('transactions').doc(id), {hidden:true})); await TO(b.commit(), 20000); } }
    else { const l = this._l(); l.forEach(t => { if (ids.includes(t.id)) t.hidden = true; }); localStorage.setItem('lph_tx', JSON.stringify(l)); }
  },
  async remove(ids) {
    if (db) { for (let i = 0; i < ids.length; i += 400) { const b = db.batch(); ids.slice(i, i + 400).forEach(id => b.delete(db.collection('transactions').doc(id))); await TO(b.commit(), 20000); } }
    else localStorage.setItem('lph_tx', JSON.stringify(this._l().filter(t => !ids.includes(t.id))));
  },
  async pay(id, ref) {
    if (db) await TO(db.collection('transactions').doc(id).update({ref, status:'Pending', updated:Date.now()}));
    else { const l = this._l(); const t = l.find(x => x.id === id); if (t) { t.ref = ref; t.status = 'Pending'; } localStorage.setItem('lph_tx', JSON.stringify(l)); }
  },
  async status(id, st) {
    if (db) await TO(db.collection('transactions').doc(id).update({status:st, updated:Date.now()}));
    else { const l = this._l(); const t = l.find(x => x.id === id); if (t) t.status = st; localStorage.setItem('lph_tx', JSON.stringify(l)); }
  }
};

/* ---------- Receipt + Email ---------- */
const LOGO_URL = (location.origin && location.origin !== 'null' ? location.origin : '') + '/img/logo-192.png';
const row = (a, b) => `<tr><td style="padding:5px 0;color:#64748b;font-size:13px">${a}</td><td style="padding:5px 0;text-align:right;font-weight:600;color:#0f172a;font-size:13px">${b}</td></tr>`;
const bars = id => [...id].map((c, i) => `<span style="display:inline-block;width:${(c.charCodeAt(0) % 3) + 1}px;height:44px;background:#111;margin-right:${(i % 2) + 1}px"></span>`).join('');
function receiptHTML(tx) {
  const st = tx.status === 'Success' ? ['#16a34a', tx.fulfilled ? 'PAID \u2022 LOAD DELIVERED' : 'PAID'] : tx.status === 'Rejected' ? ['#dc2626','REJECTED'] : ['#d97706','PENDING VERIFICATION'];
  const photo = tx.photo ? `<img src="${esc(tx.photo)}" crossorigin="anonymous" referrerpolicy="no-referrer" width="22" height="22" style="border-radius:50%;vertical-align:middle;margin-right:6px">` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:360px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
<div style="background:#0b5ed7;color:#fff;text-align:center;padding:20px 16px"><img src="${LOGO_URL}" width="76" height="76" alt="LoadPay Hub" crossorigin="anonymous" style="display:block;margin:0 auto 8px;border-radius:50%;border:3px solid #fff"><div style="font-size:20px;font-weight:800">LoadPay Hub</div><div style="font-size:12px;opacity:.85">Load \u2022 Bills \u2022 E-Wallet \u2022 More</div></div>
<div style="padding:18px 20px"><div style="text-align:center;font-weight:700;letter-spacing:1px;margin-bottom:4px">TRANSACTION RECEIPT</div>
<div style="text-align:center;margin-bottom:10px"><span style="background:${st[0]};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px">${st[1]}</span></div>
<table style="width:100%;border-collapse:collapse">${row('Transaction ID', esc(tx.id))}${row('Date & Time', fmtDate(tx.ts))}${row('Customer', photo + esc(tx.name))}${row('Service', esc(tx.service))}${row('Details', esc(tx.detail))}${row('Payment Method', esc(tx.method))}${tx.ref ? row('Reference No.', esc(tx.ref)) : ''}${tx.fee > 0 ? row('Service Fee', peso(tx.fee)) : ''}${row('Total Amount', '<span style="font-size:16px;color:#0b5ed7">' + peso(tx.amount) + '</span>')}</table>
<div style="text-align:center;margin:16px 0 4px;white-space:nowrap;overflow:hidden">${bars(tx.id + tx.id)}</div>
<div style="text-align:center;font-size:12px;color:#64748b;margin-top:8px">Stay Connected! Stay Ahead!<br>Powered by LoadPay Hub \u2022 Group 8</div></div></div>`;
}
async function sendReceipt(tx, subject) {
  if (!mailOn) return 'off';
  try {
    await loadMail();
    await emailjs.send(C.emailjs.serviceId, C.emailjs.templateId, {
      to_email: tx.email, to_name: tx.name, subject, tx_id: tx.id, service: tx.service, amount: peso(tx.amount),
      payment: tx.method, status: tx.status, date: fmtDate(tx.ts), photo_url: tx.photo || '', receipt_html: receiptHTML(tx)
    });
    return 'ok';
  } catch (e) { console.error('EmailJS error', e); return 'fail'; }
}

/* ---------- Flow helpers ---------- */
function info() {
  const f = S.flow; let r;
  if (f.type === 'load') r = {type:'Load', service:`Load (${net(f.net).name})`, detail:f.mobile, mobile:f.mobile, base:+f.amount || 0, fk:'load'};
  else if (f.type === 'data') { const p = promos(f.net)[f.promo] || {name:'', price:0}; r = {type:'Data', service:`Data (${net(f.net).name})`, detail:`${p.name} \u2022 ${f.mobile}`, mobile:f.mobile, pcode:p.code || '', base:+p.price || 0, fk:'data'}; }
  else { const w = f.cat === 'E-Wallet'; r = {type:w ? 'E-Wallet' : 'Bills', service:`${w ? 'E-Wallet' : 'Bills'} (${f.biller || ''})`, detail:`Acct: ${f.account}${f.name ? ' \u2022 ' + f.name : ''}`, base:+f.amount || 0, fk:'bill'}; }
  r.fee = +(CAT.fees[r.fk] || 0); r.amount = r.base + r.fee; return r;
}
function methodsList() {
  const i = info(), M = [], on = k => CAT.methods[k] !== false;
  if (on('Cash')) M.push(['Cash', 'cash-coin', 'Pay at the counter', true]);
  if (PM.ok) Object.keys(ONLINE).forEach(k => { if (on(k)) M.push([k, ONLINE[k][1], ONLINE[k][2], i.amount >= 20, 'Minimum \u20B120 for online payment']); });
  else {
    if (on('GCash')) M.push(['GCash', 'phone-fill', 'Pay with the GCash app', okPhone(PAY.gcash.number), 'Not set up yet by the operator']);
    if (on('Maya') && okPhone(PAY.maya.number)) M.push(['Maya', 'credit-card-2-front', 'Pay with Maya', true]);
  }
  return M;
}
function valid() {
  const f = S.flow;
  if (S.view === 'load') return !!f.net && f.amount >= 10 && f.amount <= 1000 && okPhone(f.mobile);
  if (S.view === 'data') return !!f.net && f.promo !== null && okPhone(f.mobile);
  if (S.view === 'bills') return !!f.cat && !!f.biller && f.account.trim().length >= 4 && f.amount >= 1;
  if (S.view === 'pay') return true;
  return true;
}
const chk = () => { const b = $('#next'); if (b) b.disabled = !valid(); };
const STEPS = s => `<div class="steps s${s}"><span>Select</span><span>Pay</span><span>Done</span></div>`;
const head = (t, s) => `<div class="phead"><button class="btn-back" onclick="LP.back()" aria-label="Back"><i class="bi bi-arrow-left"></i></button><h4>${t}</h4></div>${s ? STEPS(s) : ''}`;
const mobField = () => `<label class="lbl">Mobile Number</label><input class="form-control" inputmode="numeric" maxlength="11" placeholder="09XXXXXXXXX" value="${esc(S.flow.mobile)}" oninput="this.value=this.value.replace(/\\D/g,'');LP.inp('mobile',this.value)">`;
const nextBtn = (fn, label = 'Next') => `<button id="next" class="btn btn-primary btn-lg w-100 mt-4" onclick="LP.${fn}()" ${valid() ? '' : 'disabled'}>${label} <i class="bi bi-arrow-right"></i></button>`;
const GLOGO = '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

/* ---------- Views ---------- */
const V = {
  login() {
    const up = S.mode === 'up', rem = localStorage.getItem('lph_rem') !== '0';
    return `<section class="auth anim">
<div class="auth-brand"><span class="blob" style="width:240px;height:240px;top:-70px;right:-60px"></span><span class="blob" style="width:160px;height:160px;bottom:-40px;left:-30px;animation-delay:-4s"></span>
<div class="position-relative"><img class="auth-logo mb-3" src="img/logo-256.png" alt="LoadPay Hub"><h1>LoadPay Hub</h1><p class="fs-5">Digital Services, Closer to You.</p>
<ul><li><i class="bi bi-check-circle-fill"></i>Buy load and data promos for all networks</li><li><i class="bi bi-check-circle-fill"></i>Pay electricity, water, internet and more</li><li><i class="bi bi-check-circle-fill"></i>Pay with GCash or cash at the counter</li><li><i class="bi bi-check-circle-fill"></i>Instant digital receipt sent to your email</li></ul></div></div>
<div class="auth-form">${inAppBanner()}<h3 class="fw-bold">${up ? 'Create your account' : 'Welcome back!'}</h3><p class="text-secondary">${up ? 'Sign up to start paying in seconds.' : 'Sign in to continue to LoadPay Hub.'}</p>
<div class="seg"><button class="${up ? '' : 'on'}" onclick="LP.mode('in')">Sign In</button><button class="${up ? 'on' : ''}" onclick="LP.mode('up')">Sign Up</button></div>
<button class="btn-g" onclick="LP.google()">${GLOGO} Continue with Google</button><div class="or">or use email</div>
<form onsubmit="LP.auth(event)" novalidate>
${up ? '<label class="lbl mt-0">Full Name</label><input id="aName" name="name" class="form-control mb-2" autocomplete="name" placeholder="Juan Dela Cruz">' : ''}
<label class="lbl mt-0">Email</label><input id="aEmail" name="email" type="email" class="form-control mb-2" autocomplete="username" placeholder="you@gmail.com" value="${esc(S.pref || localStorage.getItem('lph_email') || '')}">
<label class="lbl mt-0">Password</label><div class="pw"><input id="aPass" name="password" type="password" class="form-control" autocomplete="${up ? 'new-password' : 'current-password'}" placeholder="At least 6 characters"><button type="button" class="eye" onclick="LP.eye(this)" aria-label="Show or hide password"><i class="bi bi-eye"></i></button></div>
${up ? '' : `<div class="d-flex justify-content-between align-items-center mt-2"><label class="form-check mb-0 small"><input id="aRem" class="form-check-input" type="checkbox" ${rem ? 'checked' : ''}> <span class="form-check-label">Remember me</span></label><a href="#" class="small fw-semibold text-decoration-none" onclick="LP.forgot();return false">Forgot password?</a></div>`}
<button class="btn btn-primary w-100 mt-4" type="submit">${up ? 'Create Account' : 'Sign In'}</button></form>
${fbOn ? '' : '<div class="alert alert-warning mt-3 mb-0 small">Local test mode: Firebase is not configured yet. Add your keys in <b>js/config.js</b>.</div>'}</div></section>`;
  },
  action() {
    const a = S.action || {}, shell = x => `<div class="panel anim text-center">${x}</div>`;
    if (a.state === 'loading') return shell('<div class="skel" style="height:140px"></div>');
    if (a.state === 'bad') return shell(`<div class="gpulse" style="background:#fee2e2;color:#dc2626"><i class="bi bi-x-lg"></i></div><h4 class="fw-bold">Link expired</h4><p class="text-secondary">This link is invalid or was already used. Request a new one from the Sign In page.</p><button class="btn btn-primary w-100" onclick="LP.toLogin()">Back to Sign In</button>`);
    if (a.mode === 'verifyEmail') return shell(`${OKSVG}<h4 class="fw-bold">Email verified</h4><p class="text-secondary">Your account is activated.</p><button class="btn btn-primary w-100" onclick="LP.toLogin()">Continue</button>`);
    if (a.state === 'done') return shell(`${OKSVG}<h4 class="fw-bold">Password updated</h4><p class="text-secondary">You can now sign in with your new password.</p><button class="btn btn-primary w-100" onclick="LP.toLogin()">Go to Sign In</button>`);
    return shell(`<div class="gpulse"><i class="bi bi-shield-lock-fill"></i></div><h4 class="fw-bold">Create a new password</h4><p class="text-secondary small">for <b>${esc(a.email)}</b></p>
<div class="pw mb-2"><input id="rp1" type="password" class="form-control" autocomplete="new-password" placeholder="New password (min. 6 characters)"><button type="button" class="eye" onclick="LP.eye(this)" aria-label="Show or hide password"><i class="bi bi-eye"></i></button></div>
<div class="pw"><input id="rp2" type="password" class="form-control" autocomplete="new-password" placeholder="Confirm new password"><button type="button" class="eye" onclick="LP.eye(this)" aria-label="Show or hide password"><i class="bi bi-eye"></i></button></div>
<button class="btn btn-primary btn-lg w-100 mt-3" onclick="LP.doReset()"><i class="bi bi-check2-circle"></i> Reset password</button>`);
  },
  activate() {
    const code = actMailOn;
    return `<div class="panel anim text-center"><div class="gpulse"><i class="bi bi-envelope-check-fill"></i></div><h4 class="fw-bold">Activate your account</h4>
<p class="text-secondary mb-1">${code ? 'We emailed your activation key to' : 'We sent an activation link to'}</p><p class="fw-bold">${esc(user.email)}</p>
${code ? `<div class="input-group input-group-lg mb-2"><input id="actIn" class="form-control text-center text-uppercase fw-bold" style="letter-spacing:3px" maxlength="9" autocomplete="one-time-code" placeholder="XXXX-XXXX" oninput="this.value=LP.fmt(this.value)"><button class="btn btn-outline-primary" onclick="LP.pasteCode()"><i class="bi bi-clipboard-check"></i> Paste</button></div>
<button class="btn btn-primary btn-lg w-100" onclick="LP.verifyCode()"><i class="bi bi-unlock-fill"></i> Activate</button>` : `<p class="small text-secondary">Open the email and tap the activation link. This page continues automatically.</p><button class="btn btn-primary btn-lg w-100" onclick="LP.checkAct()"><i class="bi bi-check2-circle"></i> I've activated my account</button>`}
<button class="btn btn-outline-primary w-100 mt-2" onclick="LP.resend()"><i class="bi bi-envelope-arrow-up"></i> ${code ? 'Send a new key' : 'Resend activation email'}</button>
<button class="btn btn-link mt-2" onclick="LP.out()">Log out</button><p class="small text-secondary mb-0">You only need to activate once. Can't find the email? Check your spam folder.</p></div>`;
  },
  home() {
    const n = esc(user.name.split(' ')[0]), h = new Date().getHours(), g = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return `<div id="dbwarn"></div><section class="hero"><div class="hero-in"><div><span class="pill"><i class="bi bi-stars"></i> Fast \u2022 Safe \u2022 Convenient</span><h1>${g}, ${n}!<br><span>LoadPay Hub</span></h1><p>Your one-stop payment station. Buy load, pay bills and more \u2014 for a better community.</p><button class="btn btn-light btn-lg fw-bold" onclick="LP.tile(0)">Get Started <i class="bi bi-arrow-right"></i></button></div><div class="phone"><span class="coin">\u20B1</span><img src="img/logo-256.png" alt="" class="phone-logo"></div></div><span class="chip c1"><i class="bi bi-wifi"></i></span><span class="chip c2"><i class="bi bi-lightning-charge-fill"></i></span><span class="chip c3"><i class="bi bi-droplet-fill"></i></span></section>
<div class="row g-3">${TILES.map((t, i) => `<div class="col-6 col-md-4 col-lg-2"><button class="tile anim" style="--d:${i * 70}ms" onclick="LP.tile(${i})"><i class="bi bi-${t[1]}"></i><span>${t[0]}</span></button></div>`).join('')}</div>
<h5 class="sec">Recent Activity</h5><div id="recent"><div class="skel" style="height:90px"></div></div><h5 class="sec">Why choose LoadPay Hub?</h5><div class="row g-3">${WHY.map((w, i) => `<div class="col-6 col-md-3"><div class="why anim" style="--d:${i * 60}ms"><i class="bi bi-${w[0]}"></i><b>${w[1]}</b><small>${w[2]}</small></div></div>`).join('')}</div>`;
  },
  load() {
    const f = S.flow, pre = CAT.loadAmounts;
    return `<div class="panel anim">${head('Buy Load', 1)}<label class="lbl mt-0">Select Network</label>
<div class="nets">${NETS.map(n => `<button class="net ${f.net === n.id ? 'on' : ''}" style="--c:${n.color}" onclick="LP.set('net','${n.id}')"><b>${n.name[0]}</b>${n.name}</button>`).join('')}</div>
<label class="lbl">Select Load Amount</label><div class="amts">${pre.map(a => `<button class="amt ${f.amount === a ? 'on' : ''}" onclick="LP.set('amount',${a})">\u20B1${a}</button>`).join('')}</div>
<input class="form-control mt-2" type="number" min="10" max="1000" placeholder="Other amount (\u20B110 - \u20B11,000)" value="${pre.includes(f.amount) || !f.amount ? '' : f.amount}" oninput="LP.inp('amount',+this.value)">
${mobField()}${nextBtn('next')}</div>`;
  },
  data() {
    const f = S.flow;
    return `<div class="panel anim">${head('Data Promos', 1)}<label class="lbl mt-0">Select Network</label>
<div class="nets">${NETS.map(n => `<button class="net ${f.net === n.id ? 'on' : ''}" style="--c:${n.color}" onclick="LP.set('net','${n.id}')"><b>${n.name[0]}</b>${n.name}</button>`).join('')}</div>
<label class="lbl">Select Promo</label>${promos(f.net).map((p, i) => `<button class="promo ${f.promo === i ? 'on' : ''}" onclick="LP.set('promo',${i})"><i class="bi bi-reception-4 fs-4 text-primary"></i><span><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></span><span class="p">\u20B1${p.price}</span></button>`).join('')}
${mobField()}${nextBtn('next')}</div>`;
  },
  bills() {
    const f = S.flow, keys = Object.keys(CATS);
    return `<div class="panel anim">${head('Bills Payment', 1)}<label class="lbl mt-0">Select Category</label>
<div class="cats">${keys.map(k => `<button class="cat ${f.cat === k ? 'on' : ''}" onclick="LP.cat('${k}')"><i class="bi bi-${CATS[k].i}"></i>${k}</button>`).join('')}</div>
${f.cat ? `<label class="lbl">Select Biller</label>${billersOf(f.cat).map((b, i) => `<button class="biller ${f.biller === b ? 'on' : ''}" onclick="LP.biller(${i})">${esc(b)}<i class="bi bi-chevron-right"></i></button>`).join('')}` : ''}
${f.biller ? `<label class="lbl">Account / Reference Number</label><input class="form-control" value="${esc(f.account)}" placeholder="Enter account number" oninput="LP.inp('account',this.value)">
<label class="lbl">Account Name (optional)</label><input class="form-control" value="${esc(f.name)}" placeholder="Name on the bill" oninput="LP.inp('name',this.value)">
<label class="lbl">Amount (\u20B1)</label><input class="form-control" type="number" min="1" value="${f.amount || ''}" placeholder="0.00" oninput="LP.inp('amount',+this.value)">` : ''}
${nextBtn('next')}</div>`;
  },
  pay() {
    const i = info(), f = S.flow, M = methodsList(), cur = M.find(m => m[0] === f.method);
    const kind = !cur ? '' : cur[0] === 'Cash' ? 'cash' : (PM.ok && ONLINE[cur[0]]) ? 'online' : 'manual';
    const note = kind === 'cash' ? `<i class="bi bi-shop fs-3 text-primary"></i><div>Please pay <b>${peso(i.amount)}</b> at the counter. The operator will confirm your order.</div>`
      : kind === 'online' ? `<i class="bi bi-shield-lock-fill fs-3 text-primary"></i><div>You will be redirected to <b>${esc(f.method)}</b> to pay <b>${peso(i.amount)}</b> securely, then brought back here automatically.</div>`
      : kind === 'manual' ? `<i class="bi bi-phone-vibrate fs-3 text-primary"></i><div>Next, we will take you to <b>${esc(f.method)}</b> to pay <b>${peso(i.amount)}</b>.</div>`
      : '<div class="text-secondary">No payment method is available right now.</div>';
    return `<div class="panel anim">${head('Payment Methods', 2)}
<div class="total mb-3"><small class="opacity-75">Total Amount</small><div class="n">${peso(i.amount)}</div><small>${esc(i.service)}${i.fee > 0 ? ' \u2022 includes ' + peso(i.fee) + ' service fee' : ''}</small></div>
<label class="lbl mt-0">Choose Payment Method</label>
${M.map(m => `<button class="method ${f.method === m[0] ? 'on' : ''}" ${m[3] ? '' : 'disabled'} onclick="LP.pm('${m[0]}')"><i class="bi bi-${m[1]}"></i><span><b>${m[0]}</b><small>${esc(m[3] ? m[2] : (m[4] || 'Not available'))}</small></span><span class="dot"></span></button>`).join('')}
<div class="payinfo">${note}</div>${nextBtn('submit', f.method === 'Cash' ? 'Place Order' : 'Pay with ' + f.method)}</div>`;
  },
  done() {
    const t = S.last, aw = t.status === 'Awaiting Payment', acc = t.method === 'Maya' ? PAY.maya : PAY.gcash;
    const kv = `<div class="text-start mb-3"><div class="kv"><span>Service</span><b>${esc(t.service)}</b></div><div class="kv"><span>Details</span><b>${esc(t.detail)}</b></div><div class="kv"><span>Amount</span><b>${peso(t.amount)}</b></div><div class="kv"><span>Payment</span><b>${esc(t.method)}</b></div><div class="kv"><span>Transaction ID</span><b>${esc(t.id)}</b></div><div class="kv"><span>Date & Time</span><b>${fmtDate(t.ts)}</b></div></div>`;
    if (aw && t.online) return `<div class="panel anim text-center">${STEPS(2)}<div class="gpulse"><i class="bi bi-phone-fill"></i></div><h4 class="fw-bold">Complete your payment</h4><p class="text-secondary mb-2">Your order is saved. Pay securely with ${esc(t.method)} \u2013 you will be redirected and brought back here automatically.</p>
<div class="total my-3"><small class="opacity-75">Amount to pay</small><div class="n">${peso(t.amount)}</div></div>
<button class="btn btn-primary btn-lg w-100" onclick="LP.payOnline('${esc(t.id)}')"><i class="bi bi-lock-fill"></i> Pay with ${esc(t.method)}</button>
<button class="btn btn-outline-primary w-100 mt-2" onclick="LP.checkPay('${esc(t.id)}')"><i class="bi bi-arrow-repeat"></i> I've paid \u2013 check status</button>
<small class="text-secondary d-block mt-3">Order ${esc(t.id)} \u2022 You can also finish this later from Home.</small></div>`;
    if (aw) return `<div class="panel anim text-center">${STEPS(2)}<div class="gpulse"><i class="bi bi-phone-fill"></i></div><h4 class="fw-bold">Complete your payment</h4><p class="text-secondary mb-2">Your order is saved. Pay now, then submit your reference number.</p>
<div class="total my-3"><small class="opacity-75">Amount to pay</small><div class="n">${peso(t.amount)}</div></div>
${t.method === 'GCash' ? '<button class="btn btn-primary btn-lg w-100 mb-3" onclick="LP.gcash()"><i class="bi bi-box-arrow-up-right"></i> Open GCash App</button>' : ''}
<div class="payinfo text-start"><ol class="small ps-3 mb-3"><li>Open <b>${esc(t.method)}</b> and tap <b>Send Money</b>.</li><li>Send exactly <b>${peso(t.amount)}</b> to the number below, or scan the QR.</li><li>Come back here, enter the reference number, and tap <b>I've Paid</b>.</li></ol>
<div class="text-center"><div class="num">${esc(acc.number)}</div><div class="fw-semibold">${esc(acc.name)}</div>${t.method === 'GCash' && PAY.gcash.qr ? `<div><img src="${esc(PAY.gcash.qr)}" alt="GCash QR"></div>` : ''}
<div class="d-flex gap-2 justify-content-center my-2"><button class="btn btn-sm btn-outline-primary" onclick="LP.copy('${esc(acc.number)}')"><i class="bi bi-clipboard"></i> Copy number</button><button class="btn btn-sm btn-outline-primary" onclick="LP.copy('${t.amount.toFixed(2)}')"><i class="bi bi-clipboard"></i> Copy amount</button></div></div></div>
<input id="refIn" class="form-control text-center mt-3" inputmode="numeric" maxlength="16" placeholder="Enter reference number" oninput="this.value=this.value.replace(/\\D/g,'')">
<button class="btn btn-primary btn-lg w-100 mt-3" onclick="LP.paid()"><i class="bi bi-check2-circle"></i> I've Paid</button>
<small class="text-secondary d-block mt-3">Order ${esc(t.id)} \u2022 You can also finish this later from History.</small></div>`;
    return `<div class="panel anim text-center">${STEPS(3)}<svg class="ok" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/><path d="M28 52l16 16 29-33"/></svg>
<h4 class="fw-bold">${t.status === 'Success' ? 'Transaction Successful!' : 'Order Submitted!'}</h4><p class="text-secondary">${t.status === 'Success' ? 'Your payment is confirmed.' + ((t.type === 'Load' || t.type === 'Data') && !t.fulfilled ? ' Your load will be sent to your number shortly.' : '') : 'Your payment is pending operator verification. You will receive an email once it is confirmed.'}</p>${kv}
<button class="btn btn-outline-primary w-100 mb-2" onclick="LP.rc('${esc(t.id)}')"><i class="bi bi-receipt"></i> View Receipt</button>
<button class="btn btn-primary w-100" onclick="LP.home()">Back to Home</button><p class="small text-secondary mt-3 mb-0"><i class="bi bi-heart-fill text-danger"></i> Thank you for using LoadPay Hub!</p></div>`;
  },
  hist() {
    return `<div class="panel wide anim">${head('Transaction History')}<div class="row g-2 mb-3">
<div class="col-md-4"><select class="form-select" onchange="LP.flt('svc',this.value)"><option value="">All Services</option><option>Load</option><option>Data</option><option>Bills</option><option>E-Wallet</option></select></div>
<div class="col-md-4"><select class="form-select" onchange="LP.flt('pay',this.value)"><option value="">All Payment Methods</option><option>Cash</option><option>GCash</option><option>Maya</option><option>GrabPay</option><option>Card</option></select></div>
<div class="col-md-4"><input class="form-control" placeholder="Search ID or details" oninput="LP.flt('q',this.value)"></div></div><div id="hist"><div class="skel"></div></div></div>`;
  },
  admin() {
    const tab = S.tab || 'ov', hide = k => tab === k ? '' : 'd-none';
    const tb = (k, ic, l) => `<li class="nav-item"><button class="nav-link ${tab === k ? 'active' : ''}" onclick="LP.tab('${k}')"><i class="bi bi-${ic}"></i> ${l}</button></li>`;
    const pmCard = `<div class="stat mb-3"><b><i class="bi bi-lightning-charge-fill"></i> Online Payments (PayMongo)</b><p class="small text-secondary mb-0 mt-1">${PM.ok ? '<span class="st Success">Connected</span> ' + esc(PM.mode) + ' mode. Customers can pay with GCash, Maya, GrabPay and Card.' : '<span class="st Pending">Not connected</span> Follow README section 9 to connect PayMongo. Until then, customers use the manual GCash/Maya number below.'}</p></div>`;
    const emailCard = `<div class="stat mb-3"><b><i class="bi bi-envelope-paper-fill"></i> Email Service (EmailJS)</b> <span id="emStatus" class="${actMailOn ? 'st Success' : 'st Pending'}">${actMailOn ? 'Connected' : 'Not set up'}</span>
<p class="small text-secondary mt-1 mb-2">Sends the activation key and receipts to customers' real emails. Create a free account at emailjs.com, add your Gmail as a service, and make 2 templates: <b>Activation</b> (must show <code>{{code}}</code> \u2013 tap <i>Copy activation template</i> below and paste it in EmailJS > Content > Edit > code view) and <b>Receipt</b> (uses <code>{{{receipt_html}}}</code>, <code>{{to_email}}</code>, <code>{{subject}}</code>).</p>
<div class="row g-2"><div class="col-md-6"><label class="lbl mt-0">Public Key</label><input id="emPk" class="form-control" autocomplete="off" value="${esc(isSet(C.emailjs.publicKey) ? C.emailjs.publicKey : '')}"></div><div class="col-md-6"><label class="lbl mt-0">Service ID</label><input id="emSv" class="form-control" autocomplete="off" value="${esc(isSet(C.emailjs.serviceId) ? C.emailjs.serviceId : '')}"></div>
<div class="col-md-6"><label class="lbl">Activation Template ID</label><input id="emAt" class="form-control" autocomplete="off" value="${esc(isSet(C.emailjs.activationTemplateId) ? C.emailjs.activationTemplateId : '')}"></div><div class="col-md-6"><label class="lbl">Receipt Template ID</label><input id="emTp" class="form-control" autocomplete="off" value="${esc(isSet(C.emailjs.templateId) ? C.emailjs.templateId : '')}"></div></div>
<div class="d-flex flex-wrap gap-2 mt-3"><button class="btn btn-primary" onclick="LP.saveMail()"><i class="bi bi-save"></i> Save email settings</button><button class="btn btn-outline-primary" onclick="LP.testMail()"><i class="bi bi-send"></i> Send test email to me</button><button class="btn btn-outline-secondary" onclick="LP.copyTpl()"><i class="bi bi-clipboard"></i> Copy activation template</button></div></div>`;
    return `<div class="anim"><div class="d-flex align-items-center justify-content-between mb-3"><div><h4 class="fw-bold mb-0">Good day, ${esc(((isOwner() ? C.owner.name : user.name) || 'Operator').split(' ')[0])}! ${isOwner() ? '<span class="owner-badge"><i class="bi bi-patch-check-fill"></i> Owner</span>' : ''}</h4><small class="text-secondary">${new Date().toLocaleDateString('en-US', {dateStyle:'full'})}</small></div><button class="btn btn-outline-primary" onclick="LP.reload()"><i class="bi bi-arrow-clockwise"></i> Refresh</button></div>${isOwner() ? `<div class="stat owner-card mb-3 d-flex align-items-center gap-3"><span class="avatar big">${user.photo ? `<img src="${esc(user.photo)}" referrerpolicy="no-referrer" alt="">` : esc(user.name[0].toUpperCase())}</span><div><b>${esc(C.owner.name)}</b> <span class="owner-badge">Owner</span><small class="d-block text-secondary">${esc(C.owner.email)} \u2022 Administrator</small></div></div>` : ''}<ul class="nav nav-pills admin-tabs mb-3">${tb('ov', 'speedometer2', 'Overview')}${tb('cat', 'tags-fill', 'Prices & Catalog')}${tb('pay', 'credit-card-2-front-fill', 'Payments')}</ul>
<div id="t-ov" class="${hide('ov')}"><div id="adm"><div class="skel"></div></div></div>
<div id="t-cat" class="${hide('cat')}"><div id="catEd"></div></div>
<div id="t-pay" class="${hide('pay')}">${pmCard}${emailCard}
<div class="stat"><b><i class="bi bi-gear-fill"></i> Manual Payment Settings</b><p class="small text-secondary mb-2">This is where customers send their GCash payments.</p>
<div class="row g-2"><div class="col-md-6"><label class="lbl mt-0">GCash Number</label><input id="pgn" class="form-control" inputmode="numeric" maxlength="11" placeholder="09XXXXXXXXX" value="${esc(PAY.gcash.number)}"></div>
<div class="col-md-6"><label class="lbl mt-0">GCash Account Name</label><input id="pgm" class="form-control" value="${esc(PAY.gcash.name)}"></div>
<div class="col-md-6"><label class="lbl">Maya Number (optional)</label><input id="pmn" class="form-control" inputmode="numeric" maxlength="11" value="${esc(PAY.maya.number)}"></div>
<div class="col-md-6"><label class="lbl">Maya Account Name</label><input id="pmm" class="form-control" value="${esc(PAY.maya.name)}"></div>
<div class="col-12"><label class="lbl">GCash QR Code (image)</label><input type="file" accept="image/*" class="form-control" onchange="LP.qr(this)"><img id="qrp" class="mt-2 rounded" style="max-width:150px;${PAY.gcash.qr ? '' : 'display:none'}" src="${esc(PAY.gcash.qr)}" alt="QR"></div></div>
<button class="btn btn-primary mt-3" onclick="LP.savePay()"><i class="bi bi-save"></i> Save Payment Settings</button></div></div></div>`;
  }
};

/* ---------- Render ---------- */
function nav() {
  const el = $('#nav');
  if (!user) { el.innerHTML = ''; return; }
  const b = (v, ic, l, fn) => `<button class="navb ${S.view === v ? 'on' : ''}" onclick="${fn}"><i class="bi bi-${ic}"></i><span>${l}</span></button>`;
  el.innerHTML = `<header class="topbar"><div class="container d-flex align-items-center gap-2">
<a class="brand" href="#" onclick="LP.home();return false"><span class="logo"><img src="img/logo-256.png" alt="LoadPay Hub"></span><span><b>LoadPay Hub</b><small>Load \u2022 Bills \u2022 E-Wallet \u2022 More</small></span></a>
<nav class="ms-auto d-flex align-items-center">${S.view === 'activate' ? '' : b('home','house-door','Home','LP.home()') + b('hist','clock-history','History','LP.hist()') + (isAdmin() ? b('admin','speedometer2','Dashboard','LP.admin()') : '')}
${isOwner() ? '<span class="owner-badge d-none d-sm-inline">Owner</span>' : ''}<span class="avatar" title="${esc(user.email)}">${user.photo ? `<img src="${esc(user.photo)}" referrerpolicy="no-referrer" alt="">` : esc(user.name[0].toUpperCase())}</span>${b('', 'box-arrow-right', 'Logout', 'LP.out()')}</nav></div></header>`;
}
function stopAct() { if (S.actT) { clearInterval(S.actT); S.actT = null; } }
function startAct() { stopAct(); S.actT = setInterval(() => LP.checkAct(true), 4000); }
function autoFill() {
  if (S.mode !== 'in' || !navigator.credentials || !window.PasswordCredential) return;
  navigator.credentials.get({password:true, mediation:'silent'}).then(c => {
    if (!c || !c.password || S.view !== 'login') return;
    const e = $('#aEmail'), p = $('#aPass'); if (e && !e.value) e.value = c.id; if (p && !p.value) p.value = c.password;
  }).catch(() => {});
}
function stagger() { document.querySelectorAll('.nets>*,.amts>*,.cats>*,.promo,.biller,.method,.kv').forEach((e, i) => e.style.setProperty('--i', i % 10)); }
function confetti() {
  const w = document.createElement('div'); w.className = 'cfw';
  w.innerHTML = Array.from({length:60}, () => `<i class="cf" style="left:${Math.random() * 100}%;background:hsl(${Math.random() * 360},85%,60%);animation-delay:${Math.random() * .6}s;animation-duration:${2 + Math.random() * 1.6}s;transform:rotate(${Math.random() * 360}deg)"></i>`).join('');
  document.body.appendChild(w); setTimeout(() => w.remove(), 4200);
}
function countUp() {
  document.querySelectorAll('[data-n]').forEach(el => {
    const n = +el.dataset.n, m = el.dataset.m === '1', t0 = performance.now();
    const step = t => { const p = Math.min(1, (t - t0) / 900), v = n * (1 - Math.pow(1 - p, 3)); el.textContent = m ? peso(v) : Math.round(v); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
document.addEventListener('pointermove', e => {
  const t = e.target.closest('.tile,.why'); if (!t || e.pointerType === 'touch') return;
  const r = t.getBoundingClientRect();
  t.style.setProperty('--rx', (-((e.clientY - r.top) / r.height - .5) * 12) + 'deg'); t.style.setProperty('--ry', (((e.clientX - r.left) / r.width - .5) * 12) + 'deg');
});
document.addEventListener('pointerout', e => { const t = e.target.closest('.tile,.why'); if (t) { t.style.removeProperty('--rx'); t.style.removeProperty('--ry'); } });
document.addEventListener('pointerdown', e => {
  if (navigator.vibrate && e.target.closest('.btn,.tile,.amt,.net,.promo,.biller,.cat,.method')) navigator.vibrate(8);
  const b = e.target.closest('.btn,.tile,.amt,.net,.promo,.biller,.cat,.method'); if (!b || b.disabled) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), d = document.createElement('span');
  d.className = 'rip'; d.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.appendChild(d); setTimeout(() => d.remove(), 650);
});
function render(anim = true) {
  if (S.view === 'admin' && !isAdmin()) S.view = 'home';
  const pb = $('#prog'); if (pb) { pb.classList.remove('run'); void pb.offsetWidth; pb.classList.add('run'); }
  const app = $('#app');
  app.className = 'container' + (anim ? '' : ' noanim');
  app.innerHTML = V[S.view]();
  nav(); stagger();
  if (S.view === 'login') autoFill();
  if (S.view === 'activate' && !actMailOn) startAct(); else stopAct();
  if (S.view === 'done' && S.last && S.last.status !== 'Awaiting Payment') confetti();
  if (S.view === 'home') { showDbWarn(); loadRecent(); }
  if (S.view === 'hist') loadHist();
  if (S.view === 'admin') { S.E = JSON.parse(JSON.stringify(CAT)); drawCatEd(); loadAdmin(); } else stopWatch();
}
function go(v) { S.stack.push(S.view); S.view = v; render(); window.scrollTo({top:0}); }
function reset(v) { S.stack = []; S.view = v; render(); window.scrollTo({top:0}); }

/* ---------- History / Admin ---------- */
const stBadge = s => `<span class="st ${esc(s).replace(/ /g, '-')}">${esc(s)}</span>`;
async function fetchTx() {
  try { S.txs = await Store.list(); } catch (e) { console.error(e); S.txs = []; toast(diag(e), 'danger'); }
}
async function loadRecent() {
  await fetchTx(); const el = $('#recent'); if (S.view !== 'home' || !el) return;
  const mine = S.txs.filter(t => t.uid === user.uid && !t.hidden), aw = mine.find(t => t.status === 'Awaiting Payment'), l = mine.slice(0, 4);
  el.innerHTML = !l.length ? '<div class="empty"><i class="bi bi-stars"></i><div>No transactions yet. Your first order will appear here.</div></div>'
    : (aw ? `<button class="rec aw" onclick="LP.open('${esc(aw.id)}')"><span class="ri"><i class="bi bi-phone-vibrate"></i></span><span class="flex-grow-1 text-start"><b>Continue your ${esc(aw.method)} payment</b><small class="d-block">${peso(aw.amount)} \u2022 ${esc(aw.service)}</small></span><i class="bi bi-chevron-right"></i></button>` : '') + l.map((t, i) => `<button class="rec" style="--i:${i}" onclick="LP.open('${esc(t.id)}')"><span class="ri"><i class="bi bi-${t.type === 'Load' ? 'phone-fill' : t.type === 'Data' ? 'wifi' : 'receipt'}"></i></span><span class="flex-grow-1 text-start"><b>${esc(t.service)}</b><small class="d-block text-secondary">${fmtDate(t.ts)}</small></span><span class="text-end"><b>${peso(t.amount)}</b><br>${stBadge(t.status)}</span></button>`).join('');
}
async function loadHist() { await fetchTx(); if (S.view === 'hist') drawHist(); }
const canDel = t => isAdmin() || t.status !== 'Awaiting Payment';
function histList() {
  const {svc, pay, q} = S.f;
  return S.txs.filter(t => (!svc || t.type === svc) && (!pay || t.method === pay) && (!q || (t.id + t.detail + t.service).toLowerCase().includes(q.toLowerCase())));
}
function drawHist(anim = true) {
  const el = $('#hist'); if (!el) return;
  el.className = anim ? '' : 'still';
  const per = 6, sel = S.sel, l = histList();
  const pages = Math.max(1, Math.ceil(l.length / per)); S.page = Math.min(S.page, pages);
  const p = l.slice((S.page - 1) * per, S.page * per), dl = l.filter(canDel), selN = dl.filter(t => sel.has(t.id)).length, allSel = dl.length > 0 && selN === dl.length;
  const bar = !l.length ? '' : S.selMode
    ? `<div class="hbar d-flex flex-wrap align-items-center gap-2 mb-3"><label class="form-check mb-0 fw-semibold"><input type="checkbox" class="form-check-input" ${allSel ? 'checked' : ''} onchange="LP.selAll(this.checked)"> <span class="form-check-label">Select all (${dl.length})</span></label><span class="ms-auto small text-secondary">${selN} selected</span><button class="btn btn-danger btn-sm" ${selN ? '' : 'disabled'} onclick="LP.askDel('sel')"><i class="bi bi-trash3-fill"></i> Delete selected</button><button class="btn btn-outline-secondary btn-sm" onclick="LP.selMode(false)">Done</button></div>`
    : `<div class="hbar d-flex flex-wrap align-items-center gap-2 mb-3"><span class="small text-secondary">${l.length} record${l.length === 1 ? '' : 's'}</span><button class="btn btn-outline-primary btn-sm ms-auto" onclick="LP.selMode(true)"><i class="bi bi-check2-square"></i> Select</button><button class="btn btn-outline-danger btn-sm" ${dl.length ? '' : 'disabled'} onclick="LP.askDel('all')"><i class="bi bi-trash3"></i> Delete all (${dl.length})</button></div>`;
  el.innerHTML = !l.length ? '<div class="text-center text-secondary py-5"><i class="bi bi-inbox fs-1"></i><div>No transactions found.</div></div>' :
    `${bar}<div class="table-responsive"><table class="tbl"><thead><tr>${S.selMode ? '<th></th>' : ''}<th>ID</th><th>Service</th><th>Amount</th><th>Payment</th><th>Status</th></tr></thead><tbody>${p.map((t, k) => { const id = esc(t.id); return `<tr class="rw ${sel.has(t.id) ? 'picked' : ''}" data-id="${id}" style="--i:${k}" onclick="${S.selMode ? `LP.tog('${id}')` : `LP.open('${id}')`}">${S.selMode ? `<td class="chk"><input type="checkbox" class="form-check-input" ${sel.has(t.id) ? 'checked' : ''} ${canDel(t) ? '' : 'disabled'} onclick="event.stopPropagation();LP.tog('${id}')"></td>` : ''}<td>${id}<br><small class="text-secondary">${fmtDate(t.ts)}</small></td><td>${esc(t.service)}</td><td><b>${peso(t.amount)}</b></td><td>${esc(t.method)}</td><td>${stBadge(t.status)}${t.fulfilled ? ' <span class="st Success">Loaded</span>' : (t.status === 'Success' && (t.type === 'Load' || t.type === 'Data') ? ' <span class="st Pending">Loading soon</span>' : '')}</td></tr>`; }).join('')}</tbody></table></div>
<div class="pg text-center mt-3">${Array.from({length:pages}, (_, i) => `<button class="${i + 1 === S.page ? 'on' : ''}" onclick="LP.pg(${i + 1})">${i + 1}</button>`).join('')}</div>`;
}

async function loadAdmin() { await fetchTx(); if (S.view !== 'admin') return; drawAdmin(); startWatch(); }
function drawAdmin() {
  if (!$('#adm')) return;
  const ok = S.txs.filter(t => t.status === 'Success'), sales = ok.reduce((a, t) => a + t.amount, 0), pend = S.txs.filter(t => t.status === 'Pending');
  const days = Array.from({length:7}, (_, i) => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - 6 + i); return d; });
  const vals = days.map(d => ok.filter(t => { const x = new Date(t.ts); x.setHours(0,0,0,0); return x.getTime() === d.getTime(); }).reduce((a, t) => a + t.amount, 0));
  const mx = Math.max(...vals, 1), pts = vals.map((v, i) => [30 + i * 90, 170 - (v / mx) * 140]);
  const todo = S.txs.filter(t => t.status === 'Success' && (t.type === 'Load' || t.type === 'Data') && !t.fulfilled);
  const queueHtml = todo.length ? `<div class="stat mb-3"><b><i class="bi bi-send-check-fill"></i> Orders to load (${todo.length})</b><p class="small text-secondary mb-1">These are paid. Load the number with your retailer or GCash app, then tap Mark loaded.</p>${todo.map(t => `<div class="qrow"><div class="flex-grow-1"><b>${esc(t.service)}</b> \u2022 ${peso(t.amount)}<div class="small"><i class="bi bi-phone"></i> <b>${esc(t.mobile || '')}</b>${t.pcode ? ' \u2022 Code: <code>' + esc(t.pcode) + '</code>' : ''}</div><div class="small text-secondary">${esc(t.detail)}</div></div><button class="btn btn-sm btn-outline-primary" title="Copy number" onclick="LP.copy('${esc(t.mobile || '')}', 'Number copied!')"><i class="bi bi-clipboard"></i></button><button class="btn btn-sm btn-success" onclick="LP.fulfill('${esc(t.id)}')"><i class="bi bi-check2-circle"></i> Mark loaded</button></div>`).join('')}</div>` : '';
  const warnHtml = actMailOn ? '' : '<div class="alert alert-warning small"><i class="bi bi-exclamation-triangle-fill"></i> Email is not set up yet, so customers cannot receive activation keys or receipts. Open the <b>Payments</b> tab > Email Service to set it up.</div>';
  const card = (l, v, ic, m) => `<div class="col-6 col-lg-3"><div class="stat"><small><i class="bi bi-${ic}"></i> ${l}</small><div class="v" data-n="${v}" data-m="${m ? 1 : 0}">0</div></div></div>`;
  $('#adm').innerHTML = `${warnHtml}${queueHtml}<div class="row g-3 mb-3">${card('Total Transactions', S.txs.length, 'receipt')}${card('Total Sales', sales, 'cash-stack', 1)}${card('Commission', sales * C.commissionRate, 'percent', 1)}${card('Pending', pend.length, 'hourglass-split')}</div>
<div class="stat mb-3"><b>Sales Overview (last 7 days)</b><svg viewBox="0 0 600 200" class="w-100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b5ed7" stop-opacity=".3"/><stop offset="1" stop-color="#0b5ed7" stop-opacity="0"/></linearGradient></defs>
<path d="M${pts[0][0]},170 ${pts.map(p => 'L' + p.join(',')).join(' ')} L${pts[6][0]},170Z" fill="url(#g)"/><polyline pathLength="1" class="line" points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#0b5ed7" stroke-width="3" stroke-linejoin="round"/>
${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="#fff" stroke="#0b5ed7" stroke-width="2.5"/><text x="${p[0]}" y="192" font-size="11" text-anchor="middle" fill="#64748b">${days[i].toLocaleDateString('en-US', {month:'short', day:'numeric'})}</text>`).join('')}</svg></div>
<div class="stat"><b>Recent Transactions</b><div class="table-responsive mt-2">${!S.txs.length ? '<div class="text-secondary py-4 text-center">No transactions yet.</div>' : `<table class="tbl"><thead><tr><th>ID</th><th>Customer</th><th>Service</th><th>Amount</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>${S.txs.slice(0, 30).map(t => `<tr><td><a href="#" onclick="LP.rc('${esc(t.id)}');return false">${esc(t.id)}</a></td><td>${esc(t.name)}<br><small class="text-secondary">${esc(t.email)}</small></td><td>${esc(t.service)}<br><small class="text-secondary">${esc(t.detail)}</small></td><td><b>${peso(t.amount)}</b></td><td>${esc(t.method)}${t.ref ? '<br><small class="text-secondary">Ref ' + esc(t.ref) + '</small>' : ''}</td><td>${stBadge(t.status)}</td><td class="text-nowrap">${t.status === 'Awaiting Payment' && t.online ? `<button class="btn btn-sm btn-outline-primary" title="Check payment" onclick="LP.verifyTx('${esc(t.id)}')"><i class="bi bi-arrow-repeat"></i></button>` : ''}${t.status === 'Pending' ? `<button class="btn btn-sm btn-success" onclick="LP.setSt('${esc(t.id)}','Success')"><i class="bi bi-check-lg"></i></button> <button class="btn btn-sm btn-outline-danger" onclick="LP.setSt('${esc(t.id)}','Rejected')"><i class="bi bi-x-lg"></i></button>` : ''}</td></tr>`).join('')}</tbody></table>`}</div></div>`;
  countUp();
}

/* ---------- Auth ---------- */
const AERR = {'auth/invalid-credential':'Incorrect email or password.','auth/wrong-password':'Incorrect email or password.','auth/user-not-found':'No account found with that email.','auth/email-already-in-use':'That email is already registered.','auth/weak-password':'Password must be at least 6 characters.','auth/invalid-email':'Please enter a valid email address.','auth/popup-closed-by-user':'Google sign-in was cancelled.','auth/network-request-failed':'Network error. Check your internet connection.','auth/too-many-requests':'Too many attempts. Please try again later.','auth/unauthorized-domain':'This domain is not authorized in Firebase (Authentication > Settings > Authorized domains).'};
AERR['auth/operation-not-allowed'] = 'Google sign-in is not enabled yet. In Firebase: Authentication > Sign-in method > Google > Enable.';
AERR['auth/web-storage-unsupported'] = 'Your browser is blocking storage. Disable private mode or allow cookies, then try again.';
AERR['auth/missing-email'] = 'Please enter your email address.';
AERR['auth/expired-action-code'] = 'This link has expired or was already used. Request a new one.';
AERR['auth/invalid-action-code'] = 'This link is invalid or was already used. Request a new one.';
AERR['auth/internal-error'] = 'Sign-in failed. Please refresh the page and try again.';
const aerr = e => {
  console.error('Auth error', e.code, e.message);
  if (e.code === 'permission-denied' || e.code === 'unavailable' || /timed out/i.test(e.message || '')) return toast(diag(e), 'danger');
  if (e.code === 'auth/unauthorized-domain') return toast(`Add "${location.hostname}" to Firebase > Authentication > Settings > Authorized domains, then try again.`, 'danger');
  if (e.code === 'auth/cancelled-popup-request') return;
  toast(AERR[e.code] || e.message || 'Something went wrong.', 'danger');
};
function enter() {
  S.view = 'home'; render(); window.scrollTo({top:0}); loadPay(); handlePmReturn();
  setTimeout(() => { if (mailOn) lazy(MAIL_JS).catch(() => {}); }, 3000);
}
function setUser(u) {
  const own = !!(u && C.owner && (u.email || '').toLowerCase() === C.owner.email.toLowerCase());
  user = u ? {uid:u.uid, email:u.email || '', name:own ? C.owner.name : (u.displayName || (u.email || 'User').split('@')[0]), photo:u.photoURL || '', verified:!!u.emailVerified} : null;
  busy(false); S.stack = [];
  if (S.action) { S.view = 'action'; render(); return; }
  if (!user) { S.view = 'login'; render(); window.scrollTo({top:0}); return; }
  if (!fbOn || isAdmin()) return enter();
  gateAct();
}
async function gateAct() {
  if (localStorage.getItem('lph_act_' + user.uid) === '1') return enter();
  busy(true, 'Checking your account\u2026');
  let exists = false;
  try {
    const s = await TO(db.collection('activations').doc(user.uid).get(), 9000);
    exists = s.exists;
    if (exists && s.data().activated) { localStorage.setItem('lph_act_' + user.uid, '1'); busy(false); return enter(); }
    if (!actMailOn && user.verified) { await markActivated(); busy(false); return enter(); }   // no email service yet: a verified account counts as activated
  } catch (e) { toast(diag(e), 'danger'); }
  busy(false); S.view = 'activate'; S.tries = 0; render(); window.scrollTo({top:0});
  const k = 'lph_sent_' + user.uid;
  if (!exists && !sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); LP.resend(true); }
}
function initAction() {
  const a = S.action, bad = () => { a.state = 'bad'; render(); };
  busy(false); render();
  if (a.mode === 'resetPassword') auth.verifyPasswordResetCode(a.code).then(em => { a.email = em; a.state = 'form'; render(); }).catch(bad);
  else auth.applyActionCode(a.code).then(() => { a.state = 'done'; render(); }).catch(bad);
}

/* ---------- Public handlers ---------- */
window.LP = {
  mode(m) { S.mode = m; render(false); },
  eye(b) { const i = b.previousElementSibling, s = i.type === 'password'; i.type = s ? 'text' : 'password'; b.firstElementChild.className = 'bi bi-eye' + (s ? '-slash' : ''); },
  async google() {
    if (!fbOn) return toast('Firebase is not configured. Add your keys in js/config.js to enable Google sign-in.', 'warning');
    if (IN_APP) return toast('Google sign-in does not work inside Messenger/Facebook. Tap "Open in browser", or use email and password.', 'warning');
    const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'});
    try { await auth.signInWithPopup(p); }
    catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') toast('Your browser blocked the Google sign-in window. Allow pop-ups for this site, or open the site in Chrome or Safari.', 'warning');
      else aerr(e);
    }
  },
  openExt() {
    if (/Android/i.test(navigator.userAgent)) window.location.href = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;package=com.android.chrome;end';
    else LP.copy(location.origin, 'Link copied! Paste it in Safari or Chrome.');
  },
  async auth(ev) {
    ev.preventDefault();
    const up = S.mode === 'up', em = $('#aEmail').value.trim(), pw = $('#aPass').value, nm = up ? $('#aName').value.trim() : '';
    if (!/^\S+@\S+\.\S+$/.test(em)) return toast('Please enter a valid email address.', 'danger');
    if (pw.length < 6) return toast('Password must be at least 6 characters.', 'danger');
    if (up && !nm) return toast('Please enter your full name.', 'danger');
    busy(true, up ? 'Creating your account\u2026' : 'Signing you in\u2026');
    try {
      if (!fbOn) {
        const u = {uid:'local-' + em.toLowerCase(), email:em, displayName:nm || em.split('@')[0], photoURL:'', emailVerified:true};
        localStorage.setItem('lph_user', JSON.stringify(u)); setUser(u);
      } else if (up) {
        let sent = false; S.regging = true;
        try {
          const c = await auth.createUserWithEmailAndPassword(em, pw);
          await c.user.updateProfile({displayName:nm});
          try { if (actMailOn) await sendCode({uid:c.user.uid, email:em}, nm); else await c.user.sendEmailVerification(); sent = true; sessionStorage.setItem('lph_sent_' + c.user.uid, '1'); } catch (se) { console.error(se); }
          await auth.signOut();
        } finally { S.regging = false; }
        S.mode = 'in'; S.pref = em; S.view = 'login'; render(); busy(false);
        toast(!sent ? 'Account created! Sign in to receive your activation key.' : actMailOn ? 'Account created! Your activation key was emailed to ' + em + '. Sign in, then paste the key.' : 'Account created! We sent an activation link to ' + em + '. Open it, then sign in.', 'success');
        const pf = $('#aPass'); if (pf) pf.focus();
        return;
      } else {
        const rem = $('#aRem') ? $('#aRem').checked : true;
        await auth.setPersistence(rem ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);
        localStorage.setItem('lph_rem', rem ? '1' : '0'); if (rem) localStorage.setItem('lph_email', em); else localStorage.removeItem('lph_email');
        await auth.signInWithEmailAndPassword(em, pw);
        if (rem && window.PasswordCredential && navigator.credentials) navigator.credentials.store(new PasswordCredential({id:em, password:pw, name:em})).catch(() => {});
      }
    } catch (e) { aerr(e); }
    busy(false);
  },
  forgot() {
    if (!fbOn) return toast('Firebase is not configured yet.', 'warning');
    $('#fpBody').innerHTML = `<div class="gpulse"><i class="bi bi-key-fill"></i></div><h5 class="fw-bold">Reset your password</h5><p class="text-secondary small">Enter your email and we will send a link to create a new password.</p>
<input id="fpEmail" type="email" class="form-control text-center" autocomplete="email" placeholder="you@gmail.com" value="${esc((($('#aEmail') || {}).value || '').trim())}">
<button class="btn btn-primary w-100 mt-3" onclick="LP.sendReset()"><i class="bi bi-send"></i> Send reset link</button><button class="btn btn-link mt-1" data-bs-dismiss="modal">Cancel</button>`;
    bootstrap.Modal.getOrCreateInstance($('#fp')).show();
  },
  async sendReset() {
    const em = ($('#fpEmail').value || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) return toast('Please enter a valid email address.', 'danger');
    busy(true, 'Sending reset link\u2026');
    try {
      await auth.sendPasswordResetEmail(em); busy(false);
      $('#fpBody').innerHTML = `<svg class="ok" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/><path d="M28 52l16 16 29-33"/></svg><h5 class="fw-bold">Check your email</h5><p class="text-secondary small">If an account exists for <b>${esc(em)}</b>, we sent a password reset link. Check your inbox and spam folder.</p><p class="small text-secondary">Signed up with Google? Just use <b>Continue with Google</b> \u2013 no password needed.</p><button class="btn btn-primary w-100" data-bs-dismiss="modal">Done</button>`;
    } catch (e) { busy(false); aerr(e); }
  },
  async checkAct(silent) {
    const cu = auth && auth.currentUser; if (!cu) return;
    try {
      await cu.reload();
      if (cu.emailVerified) { await cu.getIdToken(true); stopAct(); toast('Account activated! Welcome.', 'success'); setUser(cu); }
      else if (!silent) toast('Not activated yet. Open the activation email and tap the link.', 'warning');
    } catch (e) { if (!silent) aerr(e); }
  },
  async resend(auto) {
    const cu = auth && auth.currentUser; if (!cu || !user) return;
    if (!auto && S.cool > Date.now()) return toast('Please wait ' + Math.ceil((S.cool - Date.now()) / 1000) + 's before resending.', 'warning');
    if (!auto) busy(true, 'Sending your key\u2026');
    try {
      if (actMailOn) { await sendCode(user, user.name); S.tries = 0; } else await cu.sendEmailVerification();
      S.cool = Date.now() + 60000;
      toast((actMailOn ? 'Activation key sent to ' : 'Activation link sent to ') + user.email + '. Check your inbox and spam folder.', 'success');
    } catch (e) { toast(e && e.text ? 'Could not send the email: ' + e.text : diag(e), 'danger'); }
    if (!auto) busy(false);
  },
  fmt(v) { v = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); return v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v; },
  async pasteCode() {
    try {
      const t = String(await navigator.clipboard.readText()).toUpperCase(), m = t.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/), v = LP.fmt(m ? m[0] : t);
      $('#actIn').value = v; if (v.length === 9) LP.verifyCode(); else toast('Clipboard does not contain an activation key.', 'warning');
    } catch (e) { toast('Cannot read the clipboard. Press and hold the box, then tap Paste.', 'warning'); }
  },
  async verifyCode() {
    const raw = ($('#actIn').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length !== 8) return toast('Enter the 8-character activation key from your email.', 'warning');
    if ((S.tries = (S.tries || 0) + 1) > 6) return toast('Too many attempts. Tap "Send a new key" to get a new one.', 'warning');
    busy(true, 'Verifying your key\u2026');
    try {
      const ref = db.collection('activations').doc(user.uid), s = await TO(ref.get()), d = s.exists ? s.data() : null;
      if (!d) throw new Error('NOKEY');
      if (Date.now() > d.exp) throw new Error('EXPIRED');
      const h = await sha(raw);
      if (h !== d.hash) throw new Error('BADKEY');
      const kd = await TO(db.collection('activationKeys').doc(h).get());
      if (!kd.exists || kd.data().uid !== user.uid) throw new Error('BADKEY');   // a key only works for the account it was issued to
      await TO(ref.update({activated:true, activatedAt:Date.now()}));
      localStorage.setItem('lph_act_' + user.uid, '1'); busy(false);
      toast('Account activated! Welcome.', 'success'); enter();
    } catch (e) { busy(false); toast(actErr(e), 'danger'); }
  },
  async doReset() {
    const p = $('#rp1').value, q = $('#rp2').value;
    if (p.length < 6) return toast('Password must be at least 6 characters.', 'danger');
    if (p !== q) return toast('Passwords do not match.', 'danger');
    busy(true);
    try { await auth.confirmPasswordReset(S.action.code, p); S.pref = S.action.email; localStorage.setItem('lph_email', S.action.email); S.action.state = 'done'; busy(false); render(); }
    catch (e) { busy(false); aerr(e); }
  },
  toLogin() {
    history.replaceState({}, '', location.pathname); S.action = null;
    const cu = auth && auth.currentUser;
    if (cu) cu.reload().then(() => cu.getIdToken(true)).catch(() => {}).then(() => setUser(auth.currentUser)); else setUser(null);
  },
  tab(k) {
    S.tab = k;
    ['ov', 'cat', 'pay'].forEach(x => { const e = $('#t-' + x); if (e) e.classList.toggle('d-none', x !== k); });
    document.querySelectorAll('.admin-tabs button').forEach((b, i) => b.classList.toggle('active', ['ov', 'cat', 'pay'][i] === k));
  },
  ceNet(v) { readCat(); S.ceNet = v; drawCatEd(); },
  cp(i, k, v) { const p = S.E.promos[S.ceNet || 'smart'][i]; if (p) p[k] = k === 'price' ? +v : v; },
  cadd() { readCat(); const n = S.ceNet || 'smart'; (S.E.promos[n] = S.E.promos[n] || []).push({name:net(n).name + ' New Promo', sub:'', price:0, code:''}); drawCatEd(); },
  cdef() { readCat(); S.E.promos = promosFrom(REAL); drawCatEd(); toast('Real promos loaded. Review them, then press Save Prices & Catalog.', 'primary'); },
  cdel(i) { readCat(); S.E.promos[S.ceNet || 'smart'].splice(i, 1); drawCatEd(); },
  async saveCat() {
    if (!isAdmin()) return;
    readCat(); const E = S.E, promosOut = {};
    if (!E.loadAmounts.length) return toast('Enter at least one load amount (\u20B11 to \u20B11,000).', 'danger');
    if (Object.keys(CATS).some(k => !(E.billers[k] || []).length)) return toast('Each bill category needs at least one biller.', 'danger');
    if (!Object.values(E.methods).some(Boolean)) return toast('Enable at least one payment method.', 'danger');
    for (const n of NETS) {
      const l = (E.promos[n.id] || []).filter(p => String(p.name).trim());
      if (l.some(p => !(+p.price > 0))) return toast(`Every ${n.name} promo needs a price above 0.`, 'danger');
      promosOut[n.id] = l.map(p => ({name:String(p.name).trim(), sub:String(p.sub || '').trim(), price:+p.price, code:String(p.code || '').trim()}));
    }
    const d = {loadAmounts:E.loadAmounts, billers:E.billers, fees:E.fees, methods:E.methods, promos:promosOut, updated:Date.now()};
    busy(true, 'Saving catalog\u2026');
    try {
      if (db) await TO(db.collection('settings').doc('catalog').set(d)); else localStorage.setItem('lph_cat', JSON.stringify(d));
      ['loadAmounts', 'billers', 'fees', 'methods', 'promos'].forEach(k => { CAT[k] = d[k]; }); S.E = JSON.parse(JSON.stringify(CAT));
      toast('Saved! All devices will now use the new prices and settings.', 'success');
    } catch (e) { toast(diag(e), 'danger'); }
    busy(false); drawCatEd();
  },
  async payOnline(id) {
    const t = (S.last && S.last.id === id) ? S.last : S.txs.find(x => x.id === id); if (!t) return;
    busy(true, 'Opening ' + t.method + '\u2026');
    try { const j = await fn('pm-create', {txId:id}); window.location.href = j.url; }
    catch (e) { busy(false); toast(e.message, 'danger'); }
  },
  async checkPay(id) {
    busy(true, 'Checking your payment\u2026');
    try {
      const j = await fn('pm-verify', {txId:id}); await fetchTx(); busy(false);
      const t = S.txs.find(x => x.id === id); if (t) { S.last = t; render(); }
      if (j.paid) { if (j.changed && t) paidMail(t); } else toast('Payment not confirmed yet. If you already paid, wait a few seconds and try again.', 'warning');
    } catch (e) { busy(false); toast(e.message, 'danger'); }
  },
  async verifyTx(id) {
    if (!isAdmin()) return;
    busy(true, 'Checking payment\u2026');
    try {
      const j = await fn('pm-verify', {txId:id}); busy(false);
      const t = S.txs.find(x => x.id === id);
      if (j.paid) { toast('Payment confirmed.', 'success'); if (t) { t.status = 'Success'; if (j.changed) paidMail(t); } drawAdmin(); }
      else toast('Not paid yet.', 'warning');
    } catch (e) { busy(false); toast(e.message, 'danger'); }
  },
  async fulfill(id) {
    if (!isAdmin()) return;
    busy(true, 'Marking as loaded\u2026');
    try { await Store.fulfill(id); } catch (e) { busy(false); return toast(diag(e), 'danger'); }
    busy(false);
    const t = S.txs.find(x => x.id === id);
    if (t) { t.fulfilled = true; sendReceipt(t, `Your load was delivered \u2013 ${t.id}`).then(m => { if (m === 'ok') toast('Customer emailed.', 'success'); }); }
    toast('Marked as loaded.', 'success'); drawAdmin();
  },
  async saveMail() {
    if (!isAdmin()) return;
    const d = {publicKey:$('#emPk').value.trim(), serviceId:$('#emSv').value.trim(), templateId:$('#emTp').value.trim(), activationTemplateId:$('#emAt').value.trim()};
    if (!d.publicKey || !d.serviceId || !d.activationTemplateId) return toast('Public Key, Service ID and Activation Template ID are required.', 'danger');
    busy(true, 'Saving email settings\u2026');
    try {
      if (db) await TO(db.collection('settings').doc('email').set({...d, updated:Date.now()}));
      Object.assign(C.emailjs, d); mailInit = false; refreshMail();
      const s = $('#emStatus'); if (s) { s.className = actMailOn ? 'st Success' : 'st Pending'; s.textContent = actMailOn ? 'Connected' : 'Not set up'; }
      toast('Email settings saved. Use "Send test email" to check them.', 'success');
    } catch (e) { toast(diag(e), 'danger'); }
    busy(false);
  },
  async testMail() {
    if (!isAdmin()) return;
    if (!actMailOn) return toast('Save your email settings first.', 'warning');
    busy(true, 'Sending test email\u2026');
    try { await loadMail(); await emailjs.send(C.emailjs.serviceId, C.emailjs.activationTemplateId, actParams(user.email, user.name, 'TEST-1234')); toast('Test email sent to ' + user.email + '. Check your inbox and spam.', 'success'); }
    catch (e) { toast('Email failed: ' + ((e && (e.text || e.message)) || 'check your keys'), 'danger'); }
    busy(false);
  },
  async out() { try { if (fbOn) await auth.signOut(); else { localStorage.removeItem('lph_user'); setUser(null); } } catch (e) { aerr(e); } },
  home() { reset('home'); },
  hist() { S.f = {svc:'', pay:'', q:''}; S.page = 1; S.selMode = false; S.sel = new Set(); go('hist'); },
  admin() { if (!isAdmin()) return toast('Only the owner can open the Dashboard.', 'danger'); go('admin'); },
  back() { S.view = S.stack.pop() || 'home'; render(); },
  tile(i) { const t = TILES[i]; S.flow = newFlow(t[2], t[3]); go(VIEW[t[2]]); },
  set(k, v) { S.flow[k] = v; if (k === 'net') { S.flow.promo = null; } render(false); },
  inp(k, v) { S.flow[k] = v; chk(); },
  cat(k) { S.flow.cat = k; S.flow.biller = null; render(false); },
  biller(i) { S.flow.biller = billersOf(S.flow.cat)[i]; render(false); },
  pm(m) { S.flow.method = m; S.flow.ref = ''; render(false); },
  copy(t, m) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(m || 'Copied!', 'success')).catch(() => toast('Copy failed. Please copy it manually.', 'warning')); },
  next() {
    if (!valid()) return toast('Please complete all required fields.', 'warning');
    const M = methodsList(); if (!M.some(m => m[0] === S.flow.method && m[3])) { const m = M.find(x => x[3]); if (m) S.flow.method = m[0]; }
    go('pay');
  },
  async submit() {
    const i = info(), f = S.flow, d = new Date(), cur = methodsList().find(m => m[0] === f.method);
    if (!cur || !cur[3]) return toast('Please choose an available payment method.', 'warning');
    const online = f.method !== 'Cash' && PM.ok && !!ONLINE[f.method];
    const id = `LPH-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
    const tx = {id, uid:user.uid, email:user.email, name:user.name, photo:user.photo, type:i.type, service:i.service, detail:i.detail, mobile:i.mobile || '', pcode:i.pcode || '', amount:i.amount, fee:i.fee, method:f.method, ref:'', online, status:f.method === 'Cash' ? 'Pending' : 'Awaiting Payment', ts:Date.now()};
    busy(true, 'Saving your order\u2026');
    try { await Store.add(tx); } catch (e) { busy(false); return toast(diag(e), 'danger'); }
    busy(false); S.last = tx; S.stack = ['home']; S.view = 'done'; render(); window.scrollTo({top:0});
    if (online) return LP.payOnline(tx.id);
    if (tx.status === 'Awaiting Payment') { if (tx.method === 'GCash' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) setTimeout(LP.gcash, 1300); return; }
    const r = await sendReceipt(tx, `LoadPay Hub order received \u2013 ${tx.id}`);
    toast(r === 'ok' ? 'Receipt sent to ' + tx.email : r === 'off' ? 'Email is not configured yet (EmailJS).' : 'Order saved, but the email could not be sent.', r === 'ok' ? 'success' : 'warning');
  },
  gcash() {
    S.gOpen = true;
    const android = /Android/i.test(navigator.userAgent), t0 = Date.now();
    window.location.href = android ? 'intent://open#Intent;scheme=gcash;package=com.globe.gcash.android;end' : 'gcash://';
    setTimeout(() => { if (!document.hidden && Date.now() - t0 < 3500) toast('GCash app not detected. Open GCash manually and use the number or QR below.', 'warning'); }, 2000);
  },
  async paid() {
    const r = ($('#refIn').value || '').replace(/\D/g, '');
    if (r.length < 10 || r.length > 16) return toast('Enter the reference number from your payment receipt (about 13 digits).', 'warning');
    busy(true, 'Submitting your payment\u2026');
    try { await Store.pay(S.last.id, r); } catch (e) { busy(false); return toast(diag(e), 'danger'); }
    busy(false); S.last.ref = r; S.last.status = 'Pending'; render(); window.scrollTo({top:0});
    const m = await sendReceipt(S.last, `LoadPay Hub order received \u2013 ${S.last.id}`);
    toast(m === 'ok' ? 'Receipt sent to ' + S.last.email : m === 'off' ? 'Email is not configured yet (EmailJS).' : 'Order saved, but the email could not be sent.', m === 'ok' ? 'success' : 'warning');
  },
  open(id) {
    const t = S.txs.find(x => x.id === id); if (!t) return;
    if (t.status === 'Awaiting Payment' && t.uid === user.uid) { S.last = t; go('done'); } else LP.rc(id);
  },
  rc(id) {
    const t = [S.last, ...S.txs].find(x => x && x.id === id); if (!t) return;
    S.rc = t; $('#rcptBody').innerHTML = receiptHTML(t); bootstrap.Modal.getOrCreateInstance($('#rcpt')).show();
  },
  async dl() {
    const el = $('#rcptBody').firstElementChild; if (!el) return;
    try { await lazy(H2C_JS); } catch (e) { return toast('Download is not available. Check your internet connection.', 'danger'); }
    html2canvas(el, {scale:2, useCORS:true, backgroundColor:'#ffffff'}).then(c => { const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = (S.rc ? S.rc.id : 'receipt') + '.png'; a.click(); }).catch(() => toast('Could not create the image.', 'danger'));
  },
  qr(inp) {
    const f = inp.files[0]; if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 360 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      PAY.gcash.qr = c.toDataURL('image/jpeg', .85); const p = $('#qrp'); p.src = PAY.gcash.qr; p.style.display = '';
    };
    img.onerror = () => toast('Could not read that image.', 'danger'); img.src = url;
  },
  async savePay() {
    if (!isAdmin()) return;
    const g = $('#pgn').value.trim(), m = $('#pmn').value.trim();
    if (!okPhone(g)) return toast('Enter a valid GCash number (09XXXXXXXXX).', 'danger');
    if (m && !okPhone(m)) return toast('Enter a valid Maya number or leave it blank.', 'danger');
    PAY.gcash.number = g; PAY.gcash.name = $('#pgm').value.trim(); PAY.maya.number = m; PAY.maya.name = $('#pmm').value.trim();
    busy(true);
    try {
      const d = {gcash:PAY.gcash, maya:PAY.maya, updated:Date.now()};
      if (db) await db.collection('settings').doc('payment').set(d); else localStorage.setItem('lph_pay', JSON.stringify(d));
      toast('Payment settings saved. Customers now see your GCash.', 'success');
    } catch (e) { toast(diag(e), 'danger'); }
    busy(false);
  },
  selMode(on) { S.selMode = !!on; if (!on) S.sel.clear(); drawHist(false); },
  tog(id) {
    const t = S.txs.find(x => x.id === id); if (!t) return;
    if (!canDel(t)) return toast('This payment is not finished yet. Complete it first, then you can delete it.', 'warning');
    if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
    drawHist(false);
  },
  selAll(on) { histList().filter(canDel).forEach(t => on ? S.sel.add(t.id) : S.sel.delete(t.id)); drawHist(false); },
  askDel(kind) {
    const l = histList().filter(canDel), ids = (kind === 'all' ? l : l.filter(t => S.sel.has(t.id))).map(t => t.id);
    if (!ids.length) return toast('Nothing to delete.', 'warning');
    S.delIds = ids; const n = ids.length + ' record' + (ids.length === 1 ? '' : 's');
    $('#cfMsg').textContent = isAdmin() ? `Permanently delete ${n} from the database? This also removes ${ids.length === 1 ? 'it' : 'them'} from the customers' history and your reports. This cannot be undone.` : `Delete ${n} from your history? This only clears your own history.`;
    bootstrap.Modal.getOrCreateInstance($('#cf')).show();
  },
  async doDel() {
    const ids = S.delIds || []; if (!ids.length) return;
    bootstrap.Modal.getOrCreateInstance($('#cf')).hide();
    busy(true, 'Deleting\u2026');
    try { if (isAdmin()) await Store.remove(ids); else await Store.hide(ids); }
    catch (e) { busy(false); return toast(diag(e), 'danger'); }
    busy(false);
    const set = new Set(ids);
    document.querySelectorAll('#hist tr[data-id]').forEach(r => { if (set.has(r.dataset.id)) r.classList.add('rm'); });
    setTimeout(() => { S.txs = S.txs.filter(t => !set.has(t.id)); ids.forEach(i => S.sel.delete(i)); S.delIds = []; if (!histList().length) S.selMode = false; drawHist(false); }, 380);
    toast(ids.length + ' record' + (ids.length === 1 ? '' : 's') + ' deleted.', 'success');
  },
  flt(k, v) { S.f[k] = v; S.page = 1; drawHist(); },
  pg(n) { S.page = n; drawHist(); },
  reload() { $('#adm').innerHTML = '<div class="skel"></div>'; loadAdmin(); },
  async setSt(id, st) {
    if (!isAdmin()) return;
    busy(true);
    try { await Store.status(id, st); } catch (e) { busy(false); return toast(diag(e), 'danger'); }
    busy(false);
    const t = S.txs.find(x => x.id === id); if (t) { t.status = st; const r = await sendReceipt(t, `LoadPay Hub payment ${st === 'Success' ? 'confirmed' : 'rejected'} \u2013 ${t.id}`); toast(`Marked as ${st}.` + (r === 'ok' ? ' Customer emailed.' : ''), 'success'); }
    loadAdmin();
  }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !S.gOpen || S.view !== 'done' || !S.last || S.last.status !== 'Awaiting Payment') return;
  S.gOpen = false; const i = $('#refIn');
  if (i) { i.scrollIntoView({behavior:'smooth', block:'center'}); setTimeout(() => i.focus({preventScroll:true}), 500); }
  toast('Welcome back! Enter your reference number and tap "I\'ve Paid".', 'primary');
});

/* ---------- Boot ---------- */
if (fbOn) busy(true);
async function loadMailCfg() {
  try {
    const s = await TO(db.collection('settings').doc('email').get(), 6000);
    if (s.exists) { const d = s.data(); ['publicKey', 'serviceId', 'templateId', 'activationTemplateId'].forEach(k => { if (d[k]) C.emailjs[k] = d[k]; }); mailInit = false; refreshMail(); }
  } catch (e) { console.error('email settings', e); }
}
if (fbOn) loadMailCfg();
{ const q0 = new URLSearchParams(location.search); if (q0.get('pm') && q0.get('tx')) { sessionStorage.setItem('lph_pmret', JSON.stringify({pm:q0.get('pm'), tx:q0.get('tx')})); history.replaceState({}, '', location.pathname); } }
const qp = new URLSearchParams(location.search);
if (fbOn && qp.get('oobCode') && ['resetPassword', 'verifyEmail'].includes(qp.get('mode'))) { S.action = {mode:qp.get('mode'), code:qp.get('oobCode'), state:'loading'}; S.view = 'action'; }
if (fbOn) { if (sessionStorage.getItem('lph_rd')) { sessionStorage.removeItem('lph_rd'); auth.getRedirectResult().catch(aerr); } auth.onAuthStateChanged(u => { if (!S.regging) setUser(u); }); setTimeout(() => busy(false), 2500); if (S.action) initAction(); }
else { let u = null; try { u = JSON.parse(localStorage.getItem('lph_user') || 'null'); } catch (e) {} setUser(u); }
})();

// app.js — logique principale de ton application Invest-IMMO
import { VILLES } from './villes_seed.js';
import { fetchLoyerByInsee, fetchLoyerByCommune } from './loyers_fix.js';

const $ = s => document.querySelector(s);
const num = v => Number(v) || 0;

// ======== CALCUL DE MENSUALITÉ (PMT) ========
function pmt(rateMonthly, nMonths, principal) {
  if (rateMonthly === 0) return principal / nMonths;
  return principal * (rateMonthly) / (1 - Math.pow(1 + rateMonthly, -nMonths));
}

// ======== INIT DES VILLES (SEED CSV) ========
function initVilles() {
  const dl = $('#villesList');
  dl.innerHTML = VILLES.map(v => `<option value="${v.ville}"></option>`).join('');
}
document.addEventListener('DOMContentLoaded', initVilles);

// ======== QUAND UNE VILLE EST CHOISIE ========
function onVilleChange() {
  const nom = $('#ville').value.trim();
  const v = VILLES.find(x => x.ville.toLowerCase() === nom.toLowerCase());
  if (!v) return;

  $('#cp').value = v.cp || '';
  $('#departement').value = v.departement || '';
  $('#lignes').value = v.lignes || '';
  $('#tempsParis').value = v.tmin && v.tmax ? `${v.tmin}–${v.tmax}` : '';
  $('#gare').value = v.gare || '';

  // Remplit prix au m² si vide
  if (!$('#prixM2').value && v.prixm2) $('#prixM2').value = v.prixm2;

  // Calcule loyer estimé si surface connue
  const surf = num($('#surfaceHabitable').value);
  if (surf > 0 && v.loyerm2) {
    const loyerApprox = Math.round(v.loyerm2 * surf);
    if (!$('#loyerMensuelAutorise').value || num($('#loyerMensuelAutorise').value) === 0)
      $('#loyerMensuelAutorise').value = loyerApprox;
  }
}
$('#ville').addEventListener('change', onVilleChange);

// ======== INSEE AUTO-FILL (API GEO.GOUV.FR) ========
const INSEE_CACHE_KEY = 'insee_cache_v1';
function loadInseeCache() {
  try { return JSON.parse(localStorage.getItem(INSEE_CACHE_KEY) || '{}'); }
  catch { return {}; }
}
function saveInseeCache(obj) {
  try { localStorage.setItem(INSEE_CACHE_KEY, JSON.stringify(obj)); } catch {}
}
function findInseeInSeed(nom, cp) {
  const n = (nom || '').toLowerCase();
  const v = VILLES.find(x => x.ville.toLowerCase() === n && (!cp || x.cp === cp));
  return v && v.insee ? String(v.insee) : null;
}
async function queryInseeFromAPI(nom, cp) {
  if (!nom || !cp) return null;
  const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&codePostal=${encodeURIComponent(cp)}&fields=code,nom,codesPostaux&boost=population&limit=5`;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const arr = await res.json();
    const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const nNom = norm(nom), nCP = String(cp).trim();
    const scored = arr.map(c => {
      const hasCp = (c.codesPostaux || []).includes(nCP);
      const sameName = norm(c.nom) === nNom;
      const score = (hasCp ? 2 : 0) + (sameName ? 1 : 0);
      return { c, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0] && scored[0].score > 0 ? scored[0].c.code : (arr[0]?.code || null);
  } catch {
    return null;
  }
}
async function resolveInsee(nom, cp) {
  const key = `${(nom || '').trim()}|${(cp || '').trim()}`;
  const cache = loadInseeCache();
  if (cache[key]) return cache[key];
  let code = findInseeInSeed(nom, cp);
  if (!code) code = await queryInseeFromAPI(nom, cp);
  if (code) {
    cache[key] = code;
    saveInseeCache(cache);
  }
  return code || null;
}
async function autofillInseeAndMaybeLoyers() {
  const nom = $('#ville')?.value?.trim();
  const cp = $('#cp')?.value?.trim();
  if (!nom || !cp) return;
  const code = await resolveInsee(nom, cp);
  if (code) {
    $('#insee').value = code;
    const surface = num($('#surfaceHabitable')?.value);
    if (surface > 0) {
      if (typeof majLoyersDepuisAPI === 'function') majLoyersDepuisAPI();
    }
  }
}
$('#ville').addEventListener('change', autofillInseeAndMaybeLoyers);
$('#cp').addEventListener('change', autofillInseeAndMaybeLoyers);

// ======== LOYERS (API DATA.GOUV) ========
async function majLoyersDepuisAPI() {
  const insee = $('#insee').value.trim();
  const commune = $('#ville').value.trim();
  const type = $('#typeBien').value;

  let rec = null;
  if (insee) rec = await fetchLoyerByInsee(insee);
  if (!rec && commune) rec = await fetchLoyerByCommune(commune);

  if (!rec) {
    $('#badge-loyer').textContent = 'Loyer: introuvable';
    $('#hint-intervalle').textContent = '—';
    return;
  }

  let loyerM2 = rec.loyer_m2;
  if (type === 'maison' && rec.maison_m2) loyerM2 = rec.maison_m2;
  if (type === 'appartement' && rec.appart_m2) loyerM2 = rec.appart_m2;

  const surface = num($('#surfaceHabitable').value);
  const loyerMensuel = Math.round(loyerM2 * surface);

  $('#loyerMensuelAutorise').value = loyerMensuel || '';
  $('#badge-loyer').textContent = `${rec.commune} — ${loyerM2 ?? '—'} €/m² (R²: ${rec.r2 ?? 'n.d.'})`;
  $('#hint-intervalle').textContent =
    `Intervalle 95 % : ${rec.borne_basse ?? '—'} – ${rec.borne_haute ?? '—'} €/m² ; niveau: ${rec.niveau ?? '—'}`;
}
$('#btnMajLoyer').addEventListener('click', majLoyersDepuisAPI);
['#insee', '#ville', '#typeBien', '#surfaceHabitable'].forEach(sel =>
  $(sel).addEventListener('change', majLoyersDepuisAPI)
);

// ======== MENSUALITÉS BANQUE & SASU ========
function majMensualites() {
  const Pb = num($('#mtBanque').value);
  const rb = num($('#txBanque').value) / 100 / 12;
  const nb = num($('#dureeBanque').value) * 12;
  $('#mensuBanque').value = Pb > 0 && nb > 0 ? Math.round(pmt(rb, nb, Pb)) : 0;

  const Ps = num($('#mtSasu').value);
  const rs = num($('#txSasu').value) / 100 / 12;
  const ns = num($('#dureeSasu').value) * 12;
  $('#mensuSasu').value = Ps > 0 && ns > 0 ? Math.round(pmt(rs, ns, Ps)) : 0;
}
['#mtBanque','#txBanque','#dureeBanque','#mtSasu','#txSasu','#dureeSasu']
  .forEach(sel => $(sel).addEventListener('input', majMensualites));

// ======== CALCULS DE RÉSULTATS ========
function calculer() {
  const revenuBrut = num($('#revenuBrutMensuel').value) || num($('#loyerMensuelAutorise').value);
  const charges = num($('#chargesMensuelles').value);
  const mensuBanque = num($('#mensuBanque').value);
  const mensuSasu = num($('#mensuSasu').value);
  const couponP1 = num($('#couponP1').value);

  const cf1 = Math.round(revenuBrut - (charges + mensuBanque + mensuSasu + couponP1));
  $('#cfPhase1').value = cf1;

  const couponP2 = 1000; // phase 2
  const cf2 = Math.round(revenuBrut - (charges + mensuSasu + couponP2));
  $('#cfPhase2').value = cf2;

  let occSeuil = '—';
  if (revenuBrut > 0) {
    const besoin = charges + mensuBanque + mensuSasu + couponP1;
    const occ = Math.min(1, Math.max(0, besoin / revenuBrut));
    occSeuil = (occ * 100).toFixed(1) + ' %';
  }
  $('#occSeuil').value = occSeuil;
}
$('#btnCalcul').addEventListener('click', () => {
  majMensualites();
  calculer();
});

document.addEventListener('DOMContentLoaded', () => majMensualites());

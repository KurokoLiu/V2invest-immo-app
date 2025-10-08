// app.js — logique de calcul + intégration "Carte des loyers"
import { fetchLoyerByInsee, fetchLoyerByCommune } from './loyers_fix.js';

// ------- Utilitaires -------
const $ = s => document.querySelector(s);

function pmt(rateMonthly, nMonths, principal){
  // PMT classique (annuité constante)
  if (rateMonthly === 0) return principal / nMonths;
  return principal * (rateMonthly) / (1 - Math.pow(1 + rateMonthly, -nMonths));
}
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

// ------- Saisie: chargement des loyers -------
async function majLoyersDepuisAPI(){
  const insee   = $('#insee').value.trim();
  const commune = $('#ville').value.trim();
  const type    = $('#typeBien').value;

  let rec = null;
  if (insee) rec = await fetchLoyerByInsee(insee);
  if (!rec && commune) rec = await fetchLoyerByCommune(commune);

  if (!rec){
    $('#badge-loyer').textContent = 'Loyer: introuvable';
    $('#hint-intervalle').textContent = '—';
    return;
  }

  // Sélection de la bonne colonne si dispo
  let loyerM2 = rec.loyer_m2;
  if (type === 'maison' && rec.maison_m2) loyerM2 = rec.maison_m2;
  if (type === 'appartement' && rec.appart_m2) loyerM2 = rec.appart_m2;

  const surface = num($('#surfaceHabitable').value);
  const loyerMensuel = Math.round(loyerM2 * surface); // données = non-meublé CC; ajuste si tu veux

  $('#loyerMensuelAutorise').value = loyerMensuel || '';
  $('#badge-loyer').textContent = `${rec.commune} — ${loyerM2 ?? '—'} €/m² (R²: ${rec.r2 ?? 'n.d.'})`;
  $('#hint-intervalle').textContent = `Intervalle 95 % : ${rec.borne_basse ?? '—'} – ${rec.borne_haute ?? '—'} €/m² ; niveau: ${rec.niveau ?? '—'}`;
}

$('#btnMajLoyer').addEventListener('click', majLoyersDepuisAPI);
['#insee','#ville','#typeBien','#surfaceHabitable'].forEach(sel=>{
  $(sel).addEventListener('change', majLoyersDepuisAPI);
});

// ------- Financement: mensualités auto -------
function majMensualites(){
  // Banque
  const Pb = num($('#mtBanque').value);
  const rb = num($('#txBanque').value) / 100 / 12;  // taux mensuel
  const nb = num($('#dureeBanque').value) * 12;     // nb mois
  $('#mensuBanque').value = Pb>0 && nb>0 ? Math.round(pmt(rb, nb, Pb)) : 0;

  // SASU
  const Ps = num($('#mtSasu').value);
  const rs = num($('#txSasu').value) / 100 / 12;
  const ns = num($('#dureeSasu').value) * 12;
  $('#mensuSasu').value = Ps>0 && ns>0 ? Math.round(pmt(rs, ns, Ps)) : 0;
}

['#mtBanque','#txBanque','#dureeBanque','#mtSasu','#txSasu','#dureeSasu'].forEach(sel=>{
  $(sel).addEventListener('input', majMensualites);
});

// ------- Calculs Résultats -------
function calculer(){
  // Revenus bruts: si non saisi, on prend l’estimation autorisée
  const revenuBrut = num($('#revenuBrutMensuel').value) || num($('#loyerMensuelAutorise').value);

  const charges = num($('#chargesMensuelles').value);
  const mensuBanque = num($('#mensuBanque').value);
  const mensuSasu   = num($('#mensuSasu').value);
  const couponP1    = num($('#couponP1').value);

  const cf1 = Math.round(revenuBrut - (charges + mensuBanque + mensuSasu + couponP1));
  $('#cfPhase1').value = cf1;

  // Phase 2: plus de mensualité banque; coupon supposé 1000 €/mois (selon ton schéma)
  const couponP2 = 1000;
  const cf2 = Math.round(revenuBrut - (charges + mensuSasu + couponP2));
  $('#cfPhase2').value = cf2;

  // Occupation requise pour CF ≥ 0 (phase 1)
  // cf1 = occ * revenuBrut - (charges+mensuBanque+mensuSasu+couponP1) ≥ 0
  // occ ≥ (charges+mensuBanque+mensuSasu+couponP1) / revenuBrut
  let occSeuil = '—';
  if (revenuBrut > 0){
    const besoin = charges + mensuBanque + mensuSasu + couponP1;
    const occ = Math.min(1, Math.max(0, besoin / revenuBrut));
    occSeuil = (occ*100).toFixed(1) + ' %';
  }
  $('#occSeuil').value = occSeuil;
}

$('#btnCalcul').addEventListener('click', ()=>{
  majMensualites();
  calculer();
});

// init léger
document.addEventListener('DOMContentLoaded', ()=>{
  majMensualites();
});

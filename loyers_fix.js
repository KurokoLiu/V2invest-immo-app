// loyers_fix.js
// Charge la "Carte des loyers 2024" depuis Data.gouv et fournit 2 helpers :
//   window.fetchLoyerByInsee(insee)    -> enregistrement (ou null)
//   window.fetchLoyerByCommune(nom)    -> enregistrement (ou null)

const DATASET_SLUG = 'carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2024';
const DATASET_API  = `https://www.data.gouv.fr/api/1/datasets/${DATASET_SLUG}/`;
let __INDEX = null;

async function robustFetch(url, { retries = 2, timeoutMs = 20000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: 'follow', mode: 'cors', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      clearTimeout(t);
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function getLatestCsvResourceUrl() {
  const metaRes = await robustFetch(DATASET_API);
  const meta = await metaRes.json();
  const csvs = (meta?.resources || []).filter(r =>
    (r.format || '').toLowerCase() === 'csv' && !/documentation|doc|dictionnaire/i.test(r.title || '')
  );
  if (!csvs.length) throw new Error('Aucune ressource CSV trouvée dans le dataset Carte des loyers.');
  csvs.sort((a,b)=>new Date(b.last_modified||b.created_at||0)-new Date(a.last_modified||a.created_at||0));
  const chosen = csvs[0];
  return `https://www.data.gouv.fr/api/1/datasets/r/${chosen.id}`; // suit redirections
}

function normalizeName(s){
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[-'’]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function toNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

async function ensureIndex(){
  if (__INDEX) return __INDEX;
  // PapaParse est chargé via index.html (defer)
  const csvUrl = await getLatestCsvResourceUrl();
  const res = await robustFetch(csvUrl);
  const text = await res.text();

  const parsed = Papa.parse(text, { header:true, dynamicTyping:true, skipEmptyLines:true });
  const rows = parsed.data;

  const byInsee = new Map(), byName = new Map();
  for (const r of rows){
    const insee = String(r.INSEE_C||'').trim();
    const name  = String(r.LIBGEO  ||'').trim();
    if (!insee && !name) continue;

    const rec = {
      insee,
      commune: name,
      loyer_m2: toNum(r.loypredm2),
      borne_basse: toNum(r['lwr.IPm2']),
      borne_haute: toNum(r['upr.IPm2']),
      niveau: r.TYPPRED || null,
      nb_obs: toNum(r.nbobs_com),
      r2: toNum(r.R2_adj),
      maison_m2: r.loypredm2_maison ? toNum(r.loypredm2_maison) : null,
      appart_m2: r.loypredm2_appartement ? toNum(r.loypredm2_appartement) : null
    };
    if (insee) byInsee.set(insee, rec);
    if (name)  byName.set(normalizeName(name), rec);
  }
  __INDEX = { byInsee, byName };
  return __INDEX;
}

export async function fetchLoyerByInsee(insee){
  const { byInsee } = await ensureIndex();
  return byInsee.get(String(insee).trim()) || null;
}
export async function fetchLoyerByCommune(commune){
  const { byName } = await ensureIndex();
  return byName.get(normalizeName(commune)) || null;
}

// expose en global pour un usage hors-module si besoin
window.fetchLoyerByInsee = fetchLoyerByInsee;
window.fetchLoyerByCommune = fetchLoyerByCommune;

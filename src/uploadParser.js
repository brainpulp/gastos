import * as XLSX from 'xlsx';

// ─── Category rules (keyword → category) ────────────────────────────────────
const CAT_RULES = [
  [['havanna','parmegiano','figaro','bakery','del tomate','panificadora','new garden','maschwitz','restaurant','cafe','coffee','sushi','pizza','burger','lomito','parrilla','rotiseria','almuerzo','panaderia','confiteria','bar '], 'Dining'],
  [['supermercado','coto','carrefour','jumbo','disco ','dia ','walmart','makro','mayorista','almacen','verduleria','fiambreria','lacteos'], 'Food'],
  [['ypf','axion','shell','petrobras','nafta','combustible','fuel'], 'Gas'],
  [['farmacia','farmacity','drogueria','clinica','hospital','medico','salud','laboratorio','optica','dentista','odontolog'], 'Healthcare'],
  [['arba','afip','arca ','agip','ingresos brutos','multas','rentas','sellado','impuesto','contrib'], 'AR taxes'],
  [['sanitarios','ferreteria','corralon','construccion','materiales','ceramica','pintura','madera','mueble','herreria','plomeria','electr','pila ','pilar'], 'Carhué obra'],
  [['seamar','nautica','motor','lancha','bote','boat','marine'], 'Boat maintenance'],
  [['amazon'], 'Amazon FBA'],
  [['parking','estacionamiento','autopista','peaje','vialidad','palacio'], 'transportation'],
  [['indumentaria','zapateria','calzado','ropa','moda'], 'Clothing'],
  [['cine','teatro','entrad','espect','streaming','netflix','spotify','disney'], 'Entertainment'],
  [['hotel','hospedaje','aerolinea','aeropuerto','vuelo','booking','airbnb','despegar'], 'Travel'],
  [['uber','cabify','remis','taxi','rappi'], 'transportation'],
  [['pet shop','veterinari','mascotas'], 'pets'],
  [['gym','fitness','deporte','pilates','yoga','crossfit'], 'sports and exercise'],
  [['edesur','edenor','aysa','metrogas','naturgy','ecogas','telefonica','telecom','fibertel','cablevision','personal ','claro ','movistar','directv'], 'Home utilities'],
  [['merpago','mercadopago','mp*','meli'], 'Shopping'],
];

export function detectCat(desc) {
  const d = desc.toLowerCase();
  for (const [kws, cat] of CAT_RULES) {
    if (kws.some(k => d.includes(k))) return cat;
  }
  return 'Uncategorized Expenses';
}

// ─── Historical merchant tagging ─────────────────────────────────────────────
// On import we do NOT keyword-guess a category. Instead we look at how this exact
// merchant was categorized in the existing transactions. If one category accounts
// for MORE than 75% of that merchant's past taggings, the new rows inherit it.
// New or ambiguous merchants are left untagged (cat = null) — never guessed.

// Normalize a merchant string so historical and freshly-parsed rows key the same
// way (case-insensitive, whitespace-collapsed).
export function normMerchant(s) {
  if (!s) return null;
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim() || null;
}

// Strip the UI-level 🤖 prefix (AI-assigned marker) so AI and manual taggings of
// the same underlying category aggregate together, and the copied tag is clean.
function cleanCat(cat) {
  if (!cat) return null;
  return String(cat).replace(/^🤖\s*/, '').trim() || null;
}

/**
 * Build { [normMerchant]: { [cat]: count } } from existing transactions.
 * Skips deleted rows, transfers (structural Interbank cats), and untagged rows.
 * @param {object[]} existingTxs
 */
export function buildMerchantHistory(existingTxs = []) {
  const hist = {};
  for (const t of existingTxs) {
    if (!t || t.deleted_at || t.xfer) continue;
    const cat = cleanCat(t.cat);
    const key = normMerchant(t.merchant);
    if (!cat || !key) continue;
    (hist[key] ??= {})[cat] = (hist[key][cat] || 0) + 1;
  }
  return hist;
}

// Return the single category that accounts for > threshold of a merchant's
// history, or null if none clears the bar (mixed history → don't guess).
export function dominantCat(counts, threshold = 0.75) {
  if (!counts) return null;
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  const total = entries.reduce((a, [, c]) => a + c, 0);
  const [topCat, topCount] = entries.sort((a, b) => b[1] - a[1])[0];
  return topCount / total > threshold ? topCat : null;
}

/**
 * Resolve the category for a freshly-parsed tx from merchant history.
 * - Transfers keep their structural Interbank cat.
 * - Known merchant with a >75% dominant category → that category.
 * - New or ambiguous merchant → null (left untagged, never guessed).
 */
export function resolveCatFromHistory(tx, history, threshold = 0.75) {
  if (tx.xfer) return tx.cat ?? null;
  const key = normMerchant(tx.merchant);
  if (!key) return null;
  return dominantCat(history[key], threshold);
}

function parseARS(val) {
  if (val == null || val === '') return 0;
  return parseFloat(String(val).replace(/[^-\d.]/g, '')) || 0;
}

// ─── Blue-rate lookup ────────────────────────────────────────────────────────
// blue_rates holds one row per *published* day — no weekends/holidays, and the
// most recent days lag until the table is refreshed. An exact-date lookup misses
// constantly, and the old code papered over that with a fixed 1050 fallback that
// silently mis-converted every affected row (ARS/1050 instead of the real rate).
//
// Instead, carry the last known rate forward to the transaction date (and back to
// the earliest rate for dates before the series begins). Never invent a number:
// if blue_rates is empty the lookup returns null and the caller must handle it,
// rather than fabricating a wrong conversion.
export function makeRateLookup(blueRates = {}) {
  const sorted = Object.entries(blueRates)
    .filter(([d, r]) => d && r != null)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return (date) => {
    if (!sorted.length || !date) return null;
    const exact = blueRates[date];
    if (exact != null) return exact;
    // Most recent rate on or before `date` (carry forward)
    let carried = null;
    for (const [d, r] of sorted) {
      if (d <= date) carried = r;
      else break;
    }
    // Before the series starts → fall back to the earliest known rate
    return carried != null ? carried : sorted[0][1];
  };
}

// ─── Bank detection ──────────────────────────────────────────────────────────

export function detectBank(workbook) {
  const sheetNames = workbook.SheetNames.join(' ').toLowerCase();
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: null, range: 0 });
  const preview = rows.slice(0, 20).flat().filter(Boolean).map(c => String(c).toLowerCase()).join(' ');

  if (sheetNames.includes('ultimosmovimientos') || preview.includes('sucursal origen') || preview.includes('caja de ahorro')) {
    return 'santander_ar';
  }
  // Add more detectors here as new banks are onboarded
  // if (preview.includes('some citibank marker')) return 'citibank_us';
  return 'unknown';
}

// ─── Santander Argentina (ARS) ───────────────────────────────────────────────
// Format: sheet "UltimosMovimientos", header row has "Sucursal origen"
// Cols: [null, Fecha(DD/MM/YYYY), Sucursal, Descripción(\t-separated), Referencia, CajaAhorro, CtaCte, Saldo]
// Amounts are strings like "-35595.00". Description has literal \t between type and merchant.

function parseSantanderAR(workbook, usdRate) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const headerIdx = rows.findIndex(r =>
    r && r.some(c => c && /sucursal/i.test(String(c)))
  );
  if (headerIdx === -1) throw new Error('Formato Santander no reconocido: falta columna "Sucursal origen"');

  const dataRows = rows
    .slice(headerIdx + 1)
    .filter(r => r && r[1] && /\d{2}\/\d{2}\/\d{4}/.test(String(r[1])));

  return dataRows.map(r => {
    const [dd, mm, yyyy] = String(r[1]).split('/');
    const fecha = `${yyyy}-${mm}-${dd}`;

    // Description cell has a real tab character between tx type and merchant
    const rawDesc = String(r[3] || '').replace(/\t/g, ' | ').trim();
    const parts = rawDesc.split(' | ');
    const txType = parts[0] || '';
    const merchant = (parts[1] || '').replace(/ ?- ?tarj nro\.?\s*\d+/gi, '').trim();

    const isXfer = /transferencia|pago tarjeta de cr[eé]dito|d[eé]b(?:ito)?\. autom[aá]tico/i.test(txType);

    // Amount may be in Caja de Ahorro (col 5) or Cuenta Corriente (col 6)
    const rawArs = parseARS(r[5]) || parseARS(r[6]);

    // Santander sometimes stores credit transactions (deposits, received transfers) as negative
    // in the debit column. Force positive for descriptions that unambiguously mean money in.
    const isCredit = /deposito de efectivo|transferencia recibida|cr[eé]dito transf/i.test(txType + ' ' + String(r[3] || ''));
    const ars = isCredit ? Math.abs(rawArs) : rawArs;

    const referencia = String(r[4] || '0').trim();

    return {
      id: `u_${fecha}_${referencia}`,
      date: fecha,
      // Non-transfers come in untagged; the upload flow assigns a category from
      // merchant history (resolveCatFromHistory) when it is >75% unambiguous.
      cat: isXfer
        ? (ars > 0 ? 'Interbank incoming' : 'Interbank outgoing')
        : null,
      bank: 'Santander',
      // Placeholder only — the upload flow overwrites usd/usdRate with the
      // date-accurate blue rate (makeRateLookup) before persisting.
      usd: usdRate ? +(ars / usdRate).toFixed(2) : null,
      ars,
      usdRate: usdRate ?? null,
      xfer: isXfer,
      ym: fecha.slice(0, 7),
      year: parseInt(yyyy),
      rawDesc,
      merchant,
      referencia,
    };
  }).filter(r => r.ars !== 0);
}

// ─── Main entry point ────────────────────────────────────────────────────────

export function parseXLSX(file, usdRate) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const bank = detectBank(wb);

        let txs;
        if (bank === 'santander_ar') {
          txs = parseSantanderAR(wb, usdRate);
        } else {
          throw new Error(
            `Banco no reconocido. Formatos soportados actualmente: Santander Argentina.\n` +
            `Si es un banco nuevo, contactá al desarrollador para agregarlo.`
          );
        }

        resolve({ txs, bank, count: txs.length });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsArrayBuffer(file);
  });
}

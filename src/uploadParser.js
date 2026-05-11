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

function parseARS(val) {
  if (val == null || val === '') return 0;
  return parseFloat(String(val).replace(/[^-\d.]/g, '')) || 0;
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
    const ars = parseARS(r[5]) || parseARS(r[6]);

    const referencia = String(r[4] || '0').trim();

    return {
      id: `u_${fecha}_${referencia}`,
      date: fecha,
      cat: isXfer
        ? (ars > 0 ? 'Interbank incoming' : 'Interbank outgoing')
        : detectCat(txType + ' ' + merchant),
      bank: 'Santander',
      usd: +(ars / usdRate).toFixed(2),
      ars,
      usdRate,
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

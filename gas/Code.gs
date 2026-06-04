const C = {
  defaultVehicle: 'beat',
  r1: 2,
  timestampCol: 1,
  colStart: 2,
  refuelCol: 3,
  colOut: 'D1:E2',
  logTypeCol: 6,
  purchaseCol: 7,
  addedKmCol: 8,
  appTitle: 'Monitoring Bensin',
  timezone: 'Asia/Bangkok',
  vehicles: {
    beat: {
      key: 'beat',
      label: 'Beat',
      sheetName: 'Form Responses 1',
      range: 174.0,
      fuelFullCost: 34000,
      fuelPricePerLiter: 10000
    },
    cb150r: {
      key: 'cb150r',
      label: 'CB150R',
      sheetName: 'Form Responses 2',
      range: 320.0,
      fuelFullCost: 89180,
      fuelPricePerLiter: 10000
    }
  }
};

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(C.appTitle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function getAppData(vehicleKey) {
  const vehicle = getVehicle_(vehicleKey);
  const sht = getDataSheet_(vehicle);
  const history = buildHistory_(sht, vehicle);
  writeLatestOutput_(sht, history.stats);

  return {
    config: publicConfig_(vehicle),
    rows: history.rows.slice(-3),
    chartRows: history.rows.slice(-14),
    historyCount: history.rows.length,
    stats: history.stats
  };
}

function addEntry(payload) {
  const vehicle = getVehicle_(payload && payload.vehicleKey);
  const logType = normalizeLogType_(payload && payload.logType);
  const odometer = toNum_(payload && payload.odometer);
  const purchaseAmount = toNum_(payload && payload.purchaseAmount);

  if (logType === 'odometer' && isNaN(odometer)) {
    throw new Error('Odometer tidak valid.');
  }

  if (logType === 'partial' && (isNaN(purchaseAmount) || purchaseAmount <= 0)) {
    throw new Error('Harga beli tidak valid.');
  }

  const sht = getDataSheet_(vehicle);
  ensureHeaders_(sht);

  const addedKm = logType === 'partial'
    ? (purchaseAmount / vehicle.fuelFullCost) * vehicle.range
    : '';

  sht.appendRow([
    new Date(),
    isNaN(odometer) ? '' : odometer,
    logType === 'full' ? 'Ya' : '',
    '',
    '',
    logType,
    logType === 'partial' ? purchaseAmount : '',
    addedKm === '' ? '' : addedKm
  ]);

  const history = buildHistory_(sht, vehicle);
  writeLatestOutput_(sht, history.stats);

  return {
    config: publicConfig_(vehicle),
    rows: history.rows.slice(-3),
    chartRows: history.rows.slice(-14),
    historyCount: history.rows.length,
    stats: history.stats
  };
}

function deleteEntry(vehicleKey, rowNumber) {
  const vehicle = getVehicle_(vehicleKey);
  const sht = getDataSheet_(vehicle);
  const row = Number(rowNumber);
  if (!row || row < C.r1 || row > sht.getLastRow()) throw new Error('Baris tidak valid.');
  sht.deleteRow(row);

  const history = buildHistory_(sht, vehicle);
  writeLatestOutput_(sht, history.stats);

  return {
    config: publicConfig_(vehicle),
    rows: history.rows.slice(-3),
    chartRows: history.rows.slice(-14),
    historyCount: history.rows.length,
    stats: history.stats
  };
}

function calculate(vehicleKey) {
  const vehicle = getVehicle_(vehicleKey);
  const sht = getDataSheet_(vehicle);
  const history = buildHistory_(sht, vehicle);
  writeLatestOutput_(sht, history.stats);
  return history.stats;
}

function buildHistory_(sht, vehicle) {
  ensureHeaders_(sht);

  const lastRow = sht.getLastRow();
  if (lastRow < C.r1) {
    sht.getRange(C.colOut).clearContent();
    return {
      rows: [],
      stats: emptyStats_()
    };
  }

  const values = sht.getRange(C.r1, 1, lastRow - C.r1 + 1, 8).getValues();
  let currentOdo = null;
  let remainingKm = null;
  let lastTrip = null;
  let costTrip = null;
  let totalTripKm = 0;
  let totalPurchasedLiters = 0;
  const rows = [];

  values.forEach((row, i) => {
    const rowNumber = C.r1 + i;
    const timestamp = formatDate_(row[0]);
    const odometer = toNum_(row[1]);
    const oldRefuel = String(row[2] || '').trim().toLowerCase() === 'ya';
    const explicitType = String(row[5] || '').trim().toLowerCase();
    const purchaseAmount = toNum_(row[6]);
    let addedKm = toNum_(row[7]);
    let logType = normalizeExistingLogType_(explicitType, oldRefuel, odometer, purchaseAmount);

    if (logType === 'partial' && (isNaN(addedKm) || addedKm <= 0) && !isNaN(purchaseAmount)) {
      addedKm = (purchaseAmount / vehicle.fuelFullCost) * vehicle.range;
    }

    const purchasedLiters = logType === 'partial' && !isNaN(purchaseAmount)
      ? purchaseAmount / vehicle.fuelPricePerLiter
      : null;

    let tripForRow = null;
    if (!isNaN(odometer)) {
      tripForRow = currentOdo === null ? null : Math.abs(odometer - currentOdo);
      if (tripForRow !== null && remainingKm !== null) {
        remainingKm -= tripForRow;
      }
      currentOdo = odometer;
    }

    if (logType === 'full') {
      remainingKm = vehicle.range;
    } else if (logType === 'partial') {
      const base = remainingKm === null ? 0 : remainingKm;
      remainingKm = Math.min(vehicle.range, Math.max(0, base) + Math.max(0, addedKm || 0));
    } else if (remainingKm === null && currentOdo !== null) {
      remainingKm = vehicle.range;
    }

    if (remainingKm !== null) {
      remainingKm = Math.max(0, Math.min(vehicle.range, remainingKm));
    }

    const targetHabis = currentOdo === null || remainingKm === null ? null : currentOdo + remainingKm;
    const percentFuel = remainingKm === null ? 0 : Math.max(0, Math.min(100, (remainingKm / vehicle.range) * 100));
    const rowCostTrip = tripForRow === null ? null : Math.round(tripForRow * (vehicle.fuelFullCost / vehicle.range));
    const refuelEstimate = remainingKm === null ? null : Math.round(((vehicle.range - remainingKm) / vehicle.range) * vehicle.fuelFullCost);

    if (tripForRow !== null) {
      lastTrip = tripForRow;
      costTrip = rowCostTrip;
      totalTripKm += tripForRow;
    }

    if (purchasedLiters !== null) {
      totalPurchasedLiters += purchasedLiters;
    }

    rows.push({
      rowNumber,
      timestamp,
      odometer: isNaN(odometer) ? null : odometer,
      refuel: logType === 'full',
      logType,
      logLabel: logLabel_(logType),
      purchaseAmount: isNaN(purchaseAmount) ? null : purchaseAmount,
      addedKm: isNaN(addedKm) ? null : addedKm,
      purchasedLiters,
      remaining: remainingKm === null ? '' : fmtNum_(remainingKm, 1) + ' km',
      target: targetHabis === null ? '' : fmtNum_(targetHabis, 1) + ' km',
      targetHabis,
      remainingKm,
      percentFuel,
      lastTrip: tripForRow,
      costTrip: rowCostTrip,
      refuelEstimate,
      isEmpty: remainingKm !== null && remainingKm <= 0
    });
  });

  const latest = rows.length ? rows[rows.length - 1] : null;
  const kmPerLiter = totalTripKm > 0 && totalPurchasedLiters > 0
    ? totalTripKm / totalPurchasedLiters
    : null;
  return {
    rows,
    stats: latest ? {
      vehicleKey: vehicle.key,
      vehicleLabel: vehicle.label,
      currentOdo,
      lastTrip,
      costTrip,
      remainingKm: latest.remainingKm,
      targetHabis: latest.targetHabis,
      refuelEstimate: latest.refuelEstimate,
      percentFuel: latest.percentFuel,
      kmPerLiter,
      totalTripKm,
      totalPurchasedLiters,
      isEmpty: latest.isEmpty,
      updatedAt: new Date().toISOString()
    } : emptyStats_()
  };
}

function writeLatestOutput_(sht, stats) {
  if (!stats || stats.remainingKm === null || stats.targetHabis === null) {
    sht.getRange(C.colOut).clearContent();
    return;
  }

  const values = stats.remainingKm > 0
    ? [fmtNum_(stats.remainingKm, 1) + ' km', fmtNum_(stats.targetHabis, 1) + ' km']
    : ['BENSIN HABIS', fmtNum_(stats.targetHabis, 1) + ' km'];

  sht.getRange(C.colOut).clearContent();
  sht.getRange(C.colOut).offset(0, 0, 2, 2).setValues([
    ['Kilometer remaining', 'Isi bensin pada odometer'],
    values
  ]);
}

function getDataSheet_(vehicle) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sht = ss.getSheetByName(vehicle.sheetName);
  if (!sht) sht = ss.insertSheet(vehicle.sheetName);
  ensureHeaders_(sht);
  return sht;
}

function ensureHeaders_(sht) {
  const headers = [
    'Timestamp',
    'Odometer saat ini',
    'Isi Bensin?',
    'Kilometer remaining',
    'Isi bensin pada odometer',
    'Jenis Log',
    'Harga Beli',
    'Tambahan Km'
  ];
  const existing = sht.getRange(1, 1, 1, headers.length).getValues()[0];
  const next = headers.map((h, i) => existing[i] || h);
  const missing = headers.some((h, i) => !existing[i]);
  if (missing) sht.getRange(1, 1, 1, headers.length).setValues([next]);
}

function getVehicle_(vehicleKey) {
  const key = String(vehicleKey || C.defaultVehicle).toLowerCase();
  return C.vehicles[key] || C.vehicles[C.defaultVehicle];
}

function normalizeLogType_(value) {
  const type = String(value || 'odometer').trim().toLowerCase();
  if (type === 'partial' || type === 'odometer') return type;
  return 'odometer';
}

function normalizeExistingLogType_(explicitType, oldRefuel, odometer, purchaseAmount) {
  const type = String(explicitType || '').trim().toLowerCase();
  if (type === 'full') return 'full';
  if (type === 'partial' || type === 'odometer') return type;
  if (explicitType) return 'odometer';
  if (oldRefuel) return 'full';
  if (!isNaN(purchaseAmount) && isNaN(odometer)) return 'partial';
  return 'odometer';
}

function logLabel_(type) {
  if (type === 'full') return 'Full Tank';
  if (type === 'partial') return 'Harga';
  return 'Odometer';
}

function toNum_(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/-?[\d.]+(?:,\d+)?/);
  if (!m) return NaN;
  const val = m[0].replace(/\./g, '').replace(',', '.');
  return isNaN(parseFloat(val)) ? NaN : parseFloat(val);
}

function fmtNum_(n, d) {
  return isNaN(n) ? 'N/A' : Number(n).toFixed(d).replace('.', ',');
}

function formatDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, C.timezone, 'dd/MM/yyyy HH:mm:ss');
  }
  return String(value);
}

function publicConfig_(vehicle) {
  return {
    appTitle: C.appTitle,
    vehicleKey: vehicle.key,
    vehicleLabel: vehicle.label,
    sheetName: vehicle.sheetName,
    range: vehicle.range,
    fuelFullCost: vehicle.fuelFullCost,
    fuelPricePerLiter: vehicle.fuelPricePerLiter,
    fuelPerKm: vehicle.fuelFullCost / vehicle.range,
    vehicles: Object.keys(C.vehicles).map(key => ({
      key,
      label: C.vehicles[key].label
    }))
  };
}

function emptyStats_() {
  return {
    currentOdo: null,
    lastTrip: null,
    costTrip: null,
    remainingKm: null,
    targetHabis: null,
    refuelEstimate: null,
    percentFuel: 0,
    kmPerLiter: null,
    totalTripKm: 0,
    totalPurchasedLiters: 0,
    isEmpty: false,
    updatedAt: new Date().toISOString()
  };
}

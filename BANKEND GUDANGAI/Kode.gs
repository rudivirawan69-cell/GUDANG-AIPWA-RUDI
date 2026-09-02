/**
 * ============================================================
 * BACKEND GudangAI-69 V6.4 â€” Apps Script Unified Dashboard & Operations
 * ============================================================
 * Spreadsheet Target : COLD STORAGE (auto-detect bulan)
 * Versi              : 6.4.4+OUTBOX â€” Shortage HOLD Qty 0 + Envelope/Nonce/Reconciliation
 * Tanggal            : 19 Agustus 2026
 *
 * GABUNGAN TERBAIK V6.0 + V6.1 + V6.2:
 *
 * DARI V6.0 (Production Hardened):
 * - writeAuditLogSecure() â€” log audit transaksi lengkap
 * - verifyRowStillEmptyPath2() â€” verifikasi baris sebelum tulis
 * - findSafeEmptyRowAdaptively() â€” cari baris kosong dengan scan + buffer
 * - sendErrorEmailWithCooldown() â€” email error tanpa spam
 * - maybeArchiveAuditLog() â€” arsip log otomatis
 * - processEmailQueue() + installQueueTrigger() â€” akses Claude via email draft
 * - isDuplicateTransaction() â€” dedup fingerprint stabil
 * - testAddTransaction() â€” fungsi test
 *
 * DARI V6.1 (Auto-Detect):
 * - SPREADSHEET_ID dinamis (active â†’ PropertiesService â†’ fallback)
 * - validateTransactionDate() â€” validasi tanggal dalam bulan aktif
 * - getActiveMonth() â€” auto-detect bulan dari nama spreadsheet
 *
 * DARI V6.2 (New Features):
 * - Proteksi stok kurang dengan Qty penuh, Keterangan, dan clamp Stock Akhir
 * - resolveKodeFromNama() â€” input by name + fuzzy match + confidence
 * - SPECIAL_NAME_MAP + SIZE_MAP_CS
 * - syncDivisionStock() â€” 7 tabel divisi (DAPUR1/2, MIE, PACKING, CS, BAHAN BAKU, REKANAN)
 * - logDailySnapshot() â€” snapshot stok harian jam 23:00
 * - getDashboardData() â€” endpoint siap PWA
 * - writePORecommendations() â€” format tabel formal (baris 4 tanggal, data baris 6+)
 * - updateLastUpdateTimestamp() â€” timestamp untuk Dashboard
 *
 * CATATAN PENTING:
 * - Kolom D & E DILINDUNGI â€” script TIDAK menulis ke kolom ini
 * - Nama & Satuan diisi otomatis oleh VLOOKUP di sheet
 * - Total master data: 189 item (CV 81 + PT 108)
 *
 * TRIGGER (via setupEnvironment):
 * - sendDailyStockReport     â†’ setiap hari jam 07:00
 * - weeklyPOAutomation       â†’ Senin jam 08:00
 * - logDailySnapshot         â†’ setiap hari jam 23:00
 * - processEmailQueue        â†’ disabled/fail-closed; tidak menulis transaksi
 * ============================================================
 */


// ============================================================
// 1. KONFIGURASI GLOBAL
// ============================================================
const SPREADSHEET_ID_FALLBACK =
  "1lJw1lJwqvSNZUNBO4ZH-PgVZsgd5Cf57UgCjGJIRD05IeCwqvSNZUNBO4ZH-PgVZsgd5Cf57UgCjGJIRD05IeCw"; // September '26const ADMIN_EMAIL = "rudivirawan69@gmail.com";
const TIMEZONE = "GMT+7";
const DATE_FORMAT = "d-MMM-yyyy";
const MAX_QTY = 100000;
const MAX_RETRY = 5;
const WRITE_COLUMNS = 6; // Kolom B s.d. G
const DUP_CACHE_TTL_SEC = 60;
const MASTER_CACHE_TTL_SEC = 600;
const SCAN_BUFFER_ROWS = 25;
const COOLDOWN_EMAIL_MS = 10 * 60 * 1000; // 10 menit
const AUDIT_LOG_ARCHIVE_THRESHOLD = 5000;
const QUEUE_SUBJECT_TAG = "GUDANGAI_QUEUE";
const CONFIG_SHEET_NAME = "Config";
const APP_TITLE = "BACKEND GudangAI-69 V6.4.4";
const BACKEND_VERSION = "6.4.4+OUTBOX";
const IDEMPOTENCY_SHEET_NAME = "Idempotency Ledger";
const IDEMPOTENCY_HEADERS = [
  "CreatedAt", "UpdatedAt", "TransactionID", "Nonce", "RequestID", "DeviceID",
  "Operation", "Sheet", "Entitas", "KodeBarang", "Qty", "Tanggal", "Status",
  "Row", "WriteOccurred", "ErrorCode", "Details"
];
const MAX_IDENTITY_LENGTH = 160;
const MAX_KETERANGAN_LENGTH = 4500;

// Mapping bulan Indonesia untuk auto-detect
const BULAN_MAP = {
  "JANUARI": 1, "FEBRUARI": 2, "MARET": 3, "APRIL": 4,
  "MEI": 5, "JUNI": 6, "JULI": 7, "AGUSTUS": 8,
  "SEPTEMBER": 9, "OKTOBER": 10, "NOVEMBER": 11, "DESEMBER": 12
};

// Special mapping nama â†’ kode (wajib untuk nama ambigu)
const SPECIAL_NAME_MAP = {
  "ice cream indolakto": "CV-0030",
  "es cream indolakto": "CV-0030",
  "ice cream vanilla": "CV-0030",
  "es cream vanilla": "CV-0030"
};

// Size map untuk divisi CS (dipakai PO + Data Stok Per Divisi)
const SIZE_MAP_CS = {
  "CV-0001":"500 gram","CV-0002":"500 gram","CV-0003":"115/1kg","CV-0004":"500 gram",
  "CV-0005":"P:10-20cm/D:4-6cm","CV-0007":"2 kg","CV-0008":"500 gram","CV-0009":"1 kg",
  "CV-0028":"500 gram","CV-0030":"8 liter","CV-0032":"500 gram","CV-0033":"500 gram",
  "CV-0061":"parting 20","CV-0062":"8 liter","CV-0084":"500 gram","CV-0090":"420 gram",
  "CV-0091":"500 gram",  "CV-0095":"24 pcs","CV-0096":"40 pcs","CV-0098":"1 kg","CV-0099":"1 kg",
  "PT-0001":"500 gram","PT-0002":"500 gram","PT-0005":"115/1kg","PT-0006":"P:10-20cm/D:4-6cm",
  "PT-0007":"500 gram","PT-0008":"2 kg","PT-0009":"500 gram","PT-0029":"8 liter",
  "PT-0035":"500 gram","PT-0037":"1 kg","PT-0044":"500 gram","PT-0051":"500 gram",
  "PT-0053":"480 gram","PT-0056":"24 pcs","PT-0057":"40 pcs",  "PT-0058":"1 kg","PT-0059":"1 kg",
  "WK-0012":"500 gram","WK-0020":"500 gram","WK-0023":"500 gram","WK-0031":"parting 20",
  "WK-0032":"8 liter"
};

// Whitelist sheet transaksi
const SHEET_CONFIG = {
  "Barang masuk":  { headerRow: 3, kodeColAbsolute: 3, cols: ["Tanggal","Kode Barang","Nama Barang","Satuan","QTY","Keterangan"] },
  "Barang keluar": { headerRow: 3, kodeColAbsolute: 3, cols: ["Tanggal","Kode Barang","Nama Barang","Satuan","QTY","Keterangan"] },
  "Barang Rusak":  { headerRow: 3, kodeColAbsolute: 3, cols: ["Tanggal","Kode Barang","Nama Barang","Satuan","Jumlah","Keterangan"] }
};


// ============================================================
// 2. KONEKSI SPREADSHEET â€” DINAMIS [V6.1]
// ============================================================
let _cachedSS = null;
let _resolvedSpreadsheetId = null;

function getSpreadsheetId() {
  if (_resolvedSpreadsheetId) return _resolvedSpreadsheetId;
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) { _resolvedSpreadsheetId = active.getId(); return _resolvedSpreadsheetId; }
  } catch (e) {}
  try {
    const stored = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (stored) { _resolvedSpreadsheetId = stored; return _resolvedSpreadsheetId; }
  } catch (e) {}
  _resolvedSpreadsheetId = SPREADSHEET_ID_FALLBACK;
  return _resolvedSpreadsheetId;
}

function getSS() {
  if (!_cachedSS) {
    _cachedSS = SpreadsheetApp.openById(getSpreadsheetId());
  }
  return _cachedSS;
}

function getConfigSheet_() {
  const ss = getSS();
  return ss.getSheetByName(CONFIG_SHEET_NAME) || ss.insertSheet(CONFIG_SHEET_NAME);
}

function readConfig_() {
  const sheet = getConfigSheet_();
  const lastRow = sheet.getLastRow();
  const config = {};
  if (lastRow < 4) return config;
  const rows = sheet.getRange(4, 1, lastRow - 3, 2).getValues();
  rows.forEach(function(row) {
    const key = String(row[0] || "").trim();
    if (key) config[key] = row[1];
  });
  return config;
}

function setupConfigSheet() {
  const sheet = getConfigSheet_();
  const existing = readConfig_();
  const inferred = getActiveMonthFromName_();
  const period = String(existing.PERIODE_AKTIF || (inferred.tahun + "-" + String(inferred.bulan).padStart(2, "0")));
  const values = [
    ["PERIODE_AKTIF", period],
    ["TIMEZONE", String(existing.TIMEZONE || "GMT+7")],
    ["SPREADSHEET_ID", getSpreadsheetId()],
    ["APP_TITLE", APP_TITLE],
    ["VERSION", BACKEND_VERSION],
    ["LAST_PERIOD_CHANGE", existing.LAST_PERIOD_CHANGE || new Date()]
  ];
  sheet.getRange("A1:B1").merge();
  sheet.getRange("A1").setValue(APP_TITLE);
  sheet.getRange("A3:B3").setValues([["KEY", "VALUE"]]);
  sheet.getRange(4, 1, values.length, 2).setValues(values);
  sheet.getRange(4, 2).setNumberFormat("@");
  sheet.getRange("A1:B1").setFontWeight("bold").setFontColor("#ffffff").setBackground("#1456a0").setHorizontalAlignment("center");
  sheet.getRange("A3:B3").setFontWeight("bold").setFontColor("#ffffff").setBackground("#1d73c9").setHorizontalAlignment("center");
  sheet.getRange(4, 1, values.length, 2).setVerticalAlignment("middle");
  sheet.getRange(4, 1, values.length, 1).setFontWeight("bold").setHorizontalAlignment("left");
  sheet.getRange(4, 2, values.length, 1).setHorizontalAlignment("center");
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 300);
  sheet.setFrozenRows(3);
  if (!sheet.getFilter()) sheet.getRange(3, 1, values.length + 1, 2).createFilter();
  return { success: true, sheet: CONFIG_SHEET_NAME, period: period, title: APP_TITLE };
}

function getActiveMonthFromName_() {
  const name = getSS().getName().toUpperCase();
  for (const [bulanStr, bulanNum] of Object.entries(BULAN_MAP)) {
    if (name.includes(bulanStr)) {
      const tahunMatch = name.match(/'(\d{2})\b/) || name.match(/\b(20\d{2})\b/);
      const tahun = tahunMatch ? (tahunMatch[1].length === 2 ? 2000 + parseInt(tahunMatch[1]) : parseInt(tahunMatch[1])) : new Date().getFullYear();
      return { bulan: bulanNum, tahun: tahun, nama: bulanStr };
    }
  }
  const now = new Date();
  return { bulan: now.getMonth() + 1, tahun: now.getFullYear(), nama: "UNKNOWN" };
}

function parseActivePeriod_(period) {
  if (Object.prototype.toString.call(period) === "[object Date]" && !isNaN(period.getTime())) {
    period = Utilities.formatDate(period, "GMT+7", "yyyy-MM");
  }
  const match = String(period || "").trim().match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) return { valid: false, error: "PERIODE_AKTIF harus berformat YYYY-MM, contoh 2026-09." };
  const bulan = Number(match[2]);
  const nama = Object.keys(BULAN_MAP).find(function(key) { return BULAN_MAP[key] === bulan; });
  return { valid: true, bulan: bulan, tahun: Number(match[1]), nama: nama, value: match[1] + "-" + match[2] };
}

function setActivePeriod(period) {
  const parsed = parseActivePeriod_(period);
  if (!parsed.valid) return { success: false, error: parsed.error };
  const sheet = getConfigSheet_();
  if (sheet.getLastRow() < 4) setupConfigSheet();
  const last = sheet.getLastRow();
  const rows = sheet.getRange(4, 1, Math.max(1, last - 3), 2).getValues();
  let periodRow = -1;
  rows.forEach(function(row, index) { if (String(row[0]).trim() === "PERIODE_AKTIF") periodRow = index + 4; });
  if (periodRow < 0) { setupConfigSheet(); periodRow = 4; }
  sheet.getRange(periodRow, 2).setNumberFormat("@").setValue(parsed.value);
  const lastChangeRow = rows.findIndex(function(row) { return String(row[0]).trim() === "LAST_PERIOD_CHANGE"; });
  if (lastChangeRow >= 0) sheet.getRange(lastChangeRow + 4, 2).setValue(new Date());
  clearMasterCache();
  return { success: true, activeMonth: parsed, message: "Periode aktif diperbarui ke " + parsed.value + "." };
}

function setupNewPeriod(period) {
  const changed = setActivePeriod(period);
  if (!changed.success) return changed;
  setupConfigSheet();
  try { formatOperationalSheets_(); } catch (e) {}
  try { syncDivisionStock(); } catch (e2) {}
  try { refreshDashboard(); } catch (e3) {}
  return { success: true, activeMonth: changed.activeMonth, message: "Periode baru siap. Data transaksi lama tidak dihapus; gunakan tanggal/periode untuk pemisahan laporan." };
}

function getActiveMonth() {
  const config = readConfig_();
  const configured = parseActivePeriod_(config.PERIODE_AKTIF);
  if (configured.valid) return { bulan: configured.bulan, tahun: configured.tahun, nama: configured.nama };
  return getActiveMonthFromName_();
}

function normalizeTransactionDateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, TIMEZONE, "yyyy-MM-dd");
  }
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return iso[1] + "-" + String(iso[2]).padStart(2, "0") + "-" + String(iso[3]).padStart(2, "0");
  const parsed = new Date(raw);
  return !isNaN(parsed.getTime()) ? Utilities.formatDate(parsed, TIMEZONE, "yyyy-MM-dd") : raw;
}
function parseTransactionDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  const raw = String(value == null ? "" : value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0);
  const parsed = new Date(raw);
  return !isNaN(parsed.getTime()) ? parsed : null;
}
function formatTransactionDate_(value) {
  const parsed = parseTransactionDate_(value);
  return parsed ? Utilities.formatDate(parsed, TIMEZONE, DATE_FORMAT) : String(value == null ? "" : value).trim();
}
function validateTransactionDate(dateStr) {
  const activeMonth = getActiveMonth();
  let inputDate;
  try {
    inputDate = parseTransactionDate_(dateStr);
    if (!inputDate || isNaN(inputDate.getTime())) {
      const parts = String(dateStr || "").match(/(\d{1,2})-(\w{3})-(\d{4})/);
      if (parts) inputDate = parseTransactionDate_(parts[0]);
      if (!inputDate || isNaN(inputDate.getTime())) {
        return { valid: false, error: "Format tanggal tidak valid: '" + dateStr + "'. Gunakan d-MMM-yyyy." };
      }
    }
  } catch (e) {
    return { valid: false, error: "Gagal parse tanggal: '" + dateStr + "'." };
  }
  if (inputDate.getMonth() + 1 !== activeMonth.bulan || inputDate.getFullYear() !== activeMonth.tahun) {
    return { valid: false, error: "Tanggal '" + dateStr + "' tidak sesuai spreadsheet aktif (" + activeMonth.nama + " " + activeMonth.tahun + ")." };
  }
  return { valid: true };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// 3. ENTRY POINT: doPost / doGet
// ============================================================
function doPost(e) {
  const t0 = Date.now();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: "Payload kosong" });
    }
    const parsedBody = JSON.parse(e.postData.contents);
    const body = normalizeIncomingRequest_(parsedBody);
    if (parsedBody && parsedBody.schemaVersion && String(parsedBody.schemaVersion) !== "1.0") {
      return jsonResponse({ success: false, status: "REJECTED", code: "UNSUPPORTED_SCHEMA_VERSION", requestId: body.requestId || null, error: "schemaVersion tidak didukung." });
    }
    const secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
    if (secret && body.secret !== secret) {
      return jsonResponse({ success: false, status: "REJECTED", code: "UNAUTHORIZED", requestId: body.requestId || null, error: "Unauthorized" });
    }
    const action = body.action || "addTransaction";
    switch (action) {
      case "validateTransaction": return jsonResponse(validateTransactionRequest_(body));
      case "syncTransaction": return jsonResponse(syncTransaction(body));
      case "syncBatch":
      case "bulkSync": return jsonResponse(bulkTransaction(Object.assign({}, body, { _syncMode: true })));
      case "getTransactionStatus": return jsonResponse(getTransactionStatus(body));
      case "bootstrap": return jsonResponse(getPwaBootstrap(body));
      case "addTransaction": return jsonResponse(addTransaction(body));
      case "bulkTransaction": return jsonResponse(bulkTransaction(body));
      case "getStock":
      case "getStockByCode": return jsonResponse(getStockByCode(body.kode || body.kodeBarang, body.entitas));
      case "getAllStock": return jsonResponse(getAllStock(body.entitas || "ALL"));
      case "getLowStock": return jsonResponse(getLowStock());
      case "getTransactionHistory": return jsonResponse(getTransactionHistory(body));
      case "searchByName": return jsonResponse(searchByName(body.query || body.q || body.nama));
      case "getDashboard":
      case "getDashboardData": return jsonResponse(getDashboardData());
      case "getDashboardLegacy": return jsonResponse(getDashboard());
      case "refreshDashboard": return jsonResponse(refreshDashboard());
      case "syncDivision":
      case "syncDivisionStock": return jsonResponse(syncDivisionStock());
      case "writePO":
      case "writePORecommendations": return jsonResponse(writePORecommendations());
      case "runPOAnalysis":
      case "getPOAnalysis": return jsonResponse(analyzePORecommendations_());
      case "logDailySnapshot": return jsonResponse(logDailySnapshot());
      case "clearMasterCache": return jsonResponse(clearMasterCache());
      case "getConfig": return jsonResponse({ success: true, config: readConfig_(), activeMonth: getActiveMonth(), title: APP_TITLE });
      case "diagnoseStockFormulas": return jsonResponse(diagnoseStockFormulaPatterns_());
      case "setupConfig": return jsonResponse(setupConfigSheet());
      case "setActivePeriod": return jsonResponse(setActivePeriod(body.period || body.periode || body.activePeriod));
      case "setupNewPeriod": return jsonResponse(setupNewPeriod(body.period || body.periode || body.activePeriod));
      case "status": return jsonResponse({ success: true, status: "OK", version: BACKEND_VERSION, requestId: body.requestId, title: APP_TITLE, spreadsheet: getSS().getName(), activeMonth: getActiveMonth(), serverTime: new Date().toISOString() });
      case "ping": return jsonResponse({ success: true, status: "OK", version: BACKEND_VERSION, requestId: body.requestId, time: new Date().toISOString() });
      default: return jsonResponse({ success: false, error: "Action tidak dikenali: " + action });
    }
  } catch (err) {
    try { sendErrorEmailWithCooldown("doPost", err, { requestId: (typeof body !== "undefined" && body) ? body.requestId : "" }); } catch (notifyErr) {}
    return jsonResponse({ success: false, status: "REJECTED", code: "SERVER_ERROR", requestId: (typeof body !== "undefined" && body) ? body.requestId : null, error: err.message, _meta: { execMs: Date.now() - t0 } });
  }
}

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = params.action || "status";
  const secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
  if (secret && params.secret !== secret) {
    return jsonResponse({ success: false, status: "REJECTED", code: "UNAUTHORIZED", error: "Unauthorized" });
  }
  // GET sengaja read-only. Semua write/admin action harus POST agar tidak
  // terpanggil oleh browser prefetch, crawler, atau pembukaan ulang URL.
  const blocked = ["addTransaction", "syncTransaction", "bulkTransaction", "writePO", "writePORecommendations",
    "refreshDashboard", "refreshAllData", "syncDivision", "syncDivisionStock", "logDailySnapshot",
    "setupConfig", "setActivePeriod", "setupNewPeriod"];
  if (blocked.indexOf(action) >= 0) {
    return jsonResponse({ success: false, status: "REJECTED", code: "GET_WRITE_BLOCKED", error: "Operasi write/admin harus menggunakan POST terautentikasi." });
  }
  switch (action) {
    case "status": return jsonResponse({ success: true, status: "OK", version: BACKEND_VERSION, title: APP_TITLE, spreadsheet: getSS().getName(), activeMonth: getActiveMonth(), serverTime: new Date().toISOString() });
    case "ping": return jsonResponse({ success: true, status: "OK", version: BACKEND_VERSION, title: APP_TITLE, time: new Date().toISOString() });
    case "getConfig": return jsonResponse({ success: true, config: readConfig_(), activeMonth: getActiveMonth(), title: APP_TITLE, version: BACKEND_VERSION });
    case "runPOAnalysis":
    case "getPOAnalysis": return jsonResponse(analyzePORecommendations_());
    case "diagnoseStockFormulas": return jsonResponse(diagnoseStockFormulaPatterns_());
    case "getStock":
    case "getStockByCode": return jsonResponse(getStockByCode(e.parameter.kode || e.parameter.kodeBarang, e.parameter.entitas));
    case "getAllStock": return jsonResponse(getAllStock(e.parameter.entitas || "ALL"));
    case "getLowStock": return jsonResponse(getLowStock());
    case "getDashboard":
    case "getDashboardData": return jsonResponse(getDashboardData());
    case "getDashboardLegacy": return jsonResponse(getDashboard());
    case "getTransactionHistory": return jsonResponse(getTransactionHistory({ sheet: e.parameter.sheet, limit: e.parameter.limit }));
    case "getTransactionStatus": return jsonResponse(getTransactionStatus({ transactionId: e.parameter.transactionId, nonce: e.parameter.nonce, sheet: e.parameter.sheet }));
    case "searchByName": return jsonResponse(searchByName(e.parameter.query || e.parameter.q));
    case "getLastUpdate": return jsonResponse({ success: true, timestamp: getLastUpdateTimestamp() });
    case "bootstrap": return jsonResponse(getPwaBootstrap({ entitas: e.parameter.entitas || "ALL" }));
    default: return jsonResponse({ success: false, status: "REJECTED", code: "UNKNOWN_ACTION", error: "Action tidak dikenali: " + action });
  }
}


// ============================================================
// 4. TRANSAKSI UTAMA â€” MERGED V6.0 safety + V6.1 validation + V6.2 features
// ============================================================
function normalizeIdentity_(value, fieldName, required) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) {
    if (required) throw new Error(fieldName + " wajib diisi untuk sinkronisasi outbox.");
    return "";
  }
  if (raw.length > MAX_IDENTITY_LENGTH || /[\u0000-\u001F\u007F]/.test(raw)) {
    throw new Error(fieldName + " tidak valid atau terlalu panjang.");
  }
  return raw;
}

function normalizeIncomingRequest_(input) {
  const source = (input && typeof input === "object") ? input : {};
  const body = Object.assign({}, source);
  const payload = (source.payload && typeof source.payload === "object") ? source.payload : null;
  if (payload) {
    Object.keys(payload).forEach(function(key) {
      if (body[key] === undefined) body[key] = payload[key];
    });
    body.action = source.action || source.operation || payload.action || "addTransaction";
    if (!body.transactionId && source.offlineContext) body.transactionId = source.offlineContext.transactionId;
    if (!body.nonce && source.offlineContext) body.nonce = source.offlineContext.nonce;
    // Envelope offline dengan operation addTransaction tetap masuk gate sync.
    if (body.action === "addTransaction" && source.queueApproved === true && source.offlineContext && source.offlineContext.createdOffline === true) {
      body.action = "syncTransaction";
    }
    if ((body.action === "syncTransaction" || body.action === "addTransaction") && Array.isArray(body.transactions)) {
      body.action = "bulkTransaction";
      body._syncMode = true;
    }
  }
  if (!body.requestId) body.requestId = "REQ-" + Utilities.getUuid();
  if (!body.client || typeof body.client !== "object") body.client = {};
  if (!body.offlineContext || typeof body.offlineContext !== "object") body.offlineContext = {};
  return body;
}

function getIdempotencyLedgerSheet_() {
  const ss = getSS();
  let sheet = ss.getSheetByName(IDEMPOTENCY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(IDEMPOTENCY_SHEET_NAME);
    sheet.getRange(1, 1, 1, IDEMPOTENCY_HEADERS.length).setValues([IDEMPOTENCY_HEADERS]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, IDEMPOTENCY_HEADERS.length).setValues([IDEMPOTENCY_HEADERS]);
  } else {
    const current = sheet.getRange(1, 1, 1, IDEMPOTENCY_HEADERS.length).getValues()[0];
    if (current.join("|") !== IDEMPOTENCY_HEADERS.join("|")) {
      sheet.getRange(1, 1, 1, IDEMPOTENCY_HEADERS.length).setValues([IDEMPOTENCY_HEADERS]);
    }
  }
  return sheet;
}

function mapIdempotencyRow_(row, rowNumber) {
  const r = row || [];
  return {
    rowNumber: rowNumber,
    createdAt: r[0] || "", updatedAt: r[1] || "", transactionId: String(r[2] || ""), nonce: String(r[3] || ""),
    requestId: String(r[4] || ""), deviceId: String(r[5] || ""), operation: String(r[6] || ""),
    sheet: String(r[7] || ""), entitas: String(r[8] || ""), kodeBarang: String(r[9] || ""),
    qty: r[10], tanggal: String(r[11] || ""), status: String(r[12] || ""), dataRow: r[13] || "",
    writeOccurred: String(r[14] || ""), errorCode: String(r[15] || ""), details: String(r[16] || "")
  };
}

function findIdempotencyRecord_(transactionId, nonce) {
  const sheet = getSS().getSheetByName(IDEMPOTENCY_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, IDEMPOTENCY_HEADERS.length).getValues();
  const tx = String(transactionId || "").trim();
  const no = String(nonce || "").trim();
  for (let i = rows.length - 1; i >= 0; i--) {
    const rec = mapIdempotencyRow_(rows[i], i + 2);
    if ((tx && rec.transactionId === tx) || (no && rec.nonce === no)) return rec;
  }
  return null;
}

function appendIdempotencyRecord_(record) {
  const sheet = getIdempotencyLedgerSheet_();
  const now = new Date().toISOString();
  const values = [[
    record.createdAt || now, now, record.transactionId || "", record.nonce || "", record.requestId || "", record.deviceId || "",
    record.operation || "syncTransaction", record.sheet || "", record.entitas || "", record.kodeBarang || "", record.qty == null ? "" : record.qty,
    record.tanggal || "", record.status || "IN_PROGRESS", record.dataRow || "", record.writeOccurred == null ? "unknown" : record.writeOccurred,
    record.errorCode || "", redactSensitiveString_(String(record.details || "")).substring(0, 5000)
  ]];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, IDEMPOTENCY_HEADERS.length).setValues(values);
  return mapIdempotencyRow_(values[0], sheet.getLastRow());
}

function updateIdempotencyRecord_(record, patch) {
  if (!record || !record.rowNumber) return null;
  const sheet = getSS().getSheetByName(IDEMPOTENCY_SHEET_NAME);
  if (!sheet) return null;
  const merged = Object.assign({}, record, patch || {});
  const now = new Date().toISOString();
  const values = [[
    merged.createdAt || now, now, merged.transactionId || "", merged.nonce || "", merged.requestId || "", merged.deviceId || "",
    merged.operation || "syncTransaction", merged.sheet || "", merged.entitas || "", merged.kodeBarang || "", merged.qty == null ? "" : merged.qty,
    merged.tanggal || "", merged.status || "IN_PROGRESS", merged.dataRow || "", merged.writeOccurred == null ? "unknown" : merged.writeOccurred,
    merged.errorCode || "", redactSensitiveString_(String(merged.details || "")).substring(0, 5000)
  ]];
  sheet.getRange(record.rowNumber, 1, 1, IDEMPOTENCY_HEADERS.length).setValues(values);
  return mapIdempotencyRow_(values[0], record.rowNumber);
}

function identityMarker_(transactionId, nonce) {
  const parts = [];
  if (transactionId) parts.push("GUDANGAI_TX=" + transactionId);
  if (nonce && nonce !== transactionId) parts.push("GUDANGAI_NONCE=" + nonce);
  return parts.join(";");
}

function appendIdentityMarker_(keterangan, transactionId, nonce) {
  const marker = identityMarker_(transactionId, nonce);
  const base = String(keterangan || "").trim();
  if (!marker) return base.substring(0, MAX_KETERANGAN_LENGTH);
  const separator = base ? " | " : "";
  const maxBase = Math.max(0, MAX_KETERANGAN_LENGTH - separator.length - marker.length);
  return base.substring(0, maxBase) + separator + marker;
}

function readBackTransactionByRow_(sheetName, rowNumber, identity) {
  if (!(sheetName in SHEET_CONFIG) || !Number(rowNumber) || Number(rowNumber) <= SHEET_CONFIG[sheetName].headerRow) return { matched: false };
  const sheet = getSS().getSheetByName(sheetName);
  if (!sheet || Number(rowNumber) > sheet.getLastRow()) return { matched: false };
  const row = sheet.getRange(Number(rowNumber), 2, 1, 6).getValues()[0];
  const hasData = String(row[0] || "").trim() || String(row[1] || "").trim() || row[4] !== "" || String(row[5] || "").trim();
  if (!hasData) return { matched: false };
  return {
    matched: true, sheet: sheetName, row: Number(rowNumber),
    tanggal: normalizeTransactionDateKey_(row[0]), kodeBarang: String(row[1] || "").trim(),
    namaBarang: row[2], satuan: row[3], qty: Number(row[4]) || 0, keterangan: String(row[5] || ""),
    transactionId: String(identity && identity.transactionId || "").trim() || null,
    nonce: String(identity && identity.nonce || "").trim() || null
  };
}

function readBackTransactionByIdentity_(identity, preferredSheet) {
  const targetId = String(identity && identity.transactionId || "").trim();
  const targetNonce = String(identity && identity.nonce || "").trim();
  const ledger = findIdempotencyRecord_(targetId, targetNonce);
  if (ledger && preferredSheet && Number(ledger.dataRow) > 0) {
    const direct = readBackTransactionByRow_(preferredSheet, Number(ledger.dataRow), { transactionId: targetId, nonce: targetNonce });
    if (direct.matched) return direct;
  }
  const sheetNames = preferredSheet ? [preferredSheet] : Object.keys(SHEET_CONFIG);
  for (let s = 0; s < sheetNames.length; s++) {
    const sheetName = sheetNames[s];
    if (!(sheetName in SHEET_CONFIG)) continue;
    const config = SHEET_CONFIG[sheetName];
    const sheet = getSS().getSheetByName(sheetName);
    if (!sheet) continue;
    const last = getRealLastDataRow(sheet, config);
    if (last <= config.headerRow) continue;
    const rows = sheet.getRange(config.headerRow + 1, 2, last - config.headerRow, 6).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const note = String(r[5] || "");
      const txMatch = targetId && note.indexOf("GUDANGAI_TX=" + targetId) >= 0;
      const nonceMatch = targetNonce && note.indexOf("GUDANGAI_NONCE=" + targetNonce) >= 0;
      if (!txMatch && !nonceMatch) continue;
      return {
        matched: true, sheet: sheetName, row: config.headerRow + 1 + i,
        tanggal: normalizeTransactionDateKey_(r[0]), kodeBarang: String(r[1] || "").trim(),
        namaBarang: r[2], satuan: r[3], qty: Number(r[4]) || 0, keterangan: note,
        transactionId: targetId || null, nonce: targetNonce || null
      };
    }
  }
  return { matched: false, transactionId: targetId || null, nonce: targetNonce || null };
}

function identityPayloadMatches_(record, body) {
  if (!record) return true;
  return String(record.sheet) === String(body.sheet) && String(record.entitas).toUpperCase() === String(body.entitas).toUpperCase() &&
    String(record.kodeBarang) === String(body.kodeBarang) && Number(record.qty) === Number(body.qty) &&
    String(record.tanggal || "") === String(body.tanggal || "");
}

function getTransactionStatus(body) {
  const transactionId = String(body && (body.transactionId || (body.offlineContext && body.offlineContext.transactionId)) || "").trim();
  const nonce = String(body && (body.nonce || (body.offlineContext && body.offlineContext.nonce)) || "").trim();
  if (!transactionId && !nonce) return { success: false, status: "REJECTED", code: "IDENTITY_REQUIRED", error: "transactionId atau nonce wajib diisi." };
  const rec = findIdempotencyRecord_(transactionId, nonce);
  const readBack = readBackTransactionByIdentity_({ transactionId: transactionId, nonce: nonce }, body.sheet);
  if (rec) {
    if (readBack.matched && rec.status !== "APPLIED") {
      const updated = updateIdempotencyRecord_(rec, { status: "APPLIED", dataRow: readBack.row, writeOccurred: true, errorCode: "" });
      return { success: true, status: "APPLIED", code: "READBACK_CONFIRMED", transactionId: transactionId || rec.transactionId, nonce: nonce || rec.nonce, record: updated, readBack: readBack };
    }
    return { success: rec.status === "APPLIED", status: rec.status, code: rec.errorCode || "LEDGER_FOUND", transactionId: transactionId || rec.transactionId, nonce: nonce || rec.nonce, writeOccurred: rec.writeOccurred, retryable: rec.status === "FAILED" && rec.writeOccurred === "false", record: rec, readBack: readBack };
  }
  if (readBack.matched) return { success: true, status: "APPLIED", code: "READBACK_FOUND", transactionId: transactionId || null, nonce: nonce || null, writeOccurred: true, readBack: readBack };
  return { success: false, status: "NOT_FOUND", code: "IDENTITY_NOT_FOUND", transactionId: transactionId || null, nonce: nonce || null, writeOccurred: false, readBack: readBack };
}

function getPwaBootstrap(body) {
  const entitas = String(body && body.entitas || "ALL").toUpperCase();
  const all = getAllStock(entitas === "CV" || entitas === "PT" ? entitas : "ALL");
  if (!all.success) return all;
  const capturedAt = new Date().toISOString();
  const snapshotText = JSON.stringify(all.items);
  let checksum = "";
  try { checksum = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, snapshotText)).substring(0, 32); } catch (e) {}
  const snapshotId = "SNAP-" + Utilities.formatDate(new Date(), TIMEZONE, "yyyyMMdd-HHmmss") + "-" + checksum;
  return {
    success: true, status: "OK", version: BACKEND_VERSION, serverTime: capturedAt, capturedAt: capturedAt,
    snapshotId: snapshotId, activePeriod: getActiveMonth(), lastUpdate: getLastUpdateTimestamp(),
    masterVersion: checksum, stockVersion: checksum, entity: entitas, count: all.count, items: all.items
  };
}

function syncTransaction(body) {
  const request = normalizeIncomingRequest_(body);
  if (request.queueApproved !== true) return { success: false, status: "REJECTED", code: "QUEUE_APPROVAL_REQUIRED", requestId: request.requestId, error: "queueApproved=true wajib untuk sinkronisasi outbox." };
  let transactionId = "", nonce = "";
  try {
    transactionId = normalizeIdentity_(request.transactionId || (request.offlineContext && request.offlineContext.transactionId), "transactionId", false);
    nonce = normalizeIdentity_(request.nonce || (request.offlineContext && request.offlineContext.nonce) || transactionId, "nonce", true);
  } catch (e) { return { success: false, status: "REJECTED", code: "INVALID_IDENTITY", requestId: request.requestId, error: e.message }; }
  if (!transactionId) transactionId = nonce;
  request.transactionId = transactionId;
  request.nonce = nonce;
  request.action = "addTransaction";
  request._syncMode = true;
  const validation = validateTransactionRequest_(request, { requireDate: true, requireEntity: true });
  if (!validation.valid) return Object.assign(validation, { requestId: request.requestId, transactionId: transactionId, nonce: nonce, status: "REJECTED", writeOccurred: false });
  return addTransaction(request);
}

function addTransaction(body) {
  const t0 = Date.now();
  if (!body || typeof body !== "object") return { success: false, status: "REJECTED", code: "INVALID_BODY", error: "Body kosong / tidak valid" };
  const request = normalizeIncomingRequest_(body);
  const sheetName = String(request.sheet || "").trim();
  if (!(sheetName in SHEET_CONFIG)) return { success: false, status: "REJECTED", code: "SHEET_NOT_ALLOWED", requestId: request.requestId, error: "Sheet tidak diizinkan: " + sheetName };
  const config = SHEET_CONFIG[sheetName];
  const ss = getSS();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, status: "REJECTED", code: "SHEET_NOT_FOUND", requestId: request.requestId, error: "Sheet fisik tidak ditemukan: " + sheetName };

  const validation = validateTransactionRequest_(request, { requireDate: !!request._syncMode, requireEntity: true });
  if (!validation.valid) return Object.assign(validation, { requestId: request.requestId, status: "REJECTED", writeOccurred: false });

  const entitas = String(request.entitas || validation.entitas || "").trim().toUpperCase();
  const kode = String(request.kodeBarang || "").trim();
  const numericQty = Number(request.qty);
  const requestedDate = request.tanggal || Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT);
  const formattedDate = formatTransactionDate_(requestedDate);
  const expectedDateKey = normalizeTransactionDateKey_(formattedDate);
  const finalDateCheck = validateTransactionDate(formattedDate);
  if (!finalDateCheck.valid) return { success: false, status: "REJECTED", code: "INVALID_DATE", requestId: request.requestId, transactionId: request.transactionId || null, error: finalDateCheck.error, writeOccurred: false };
  const originalKeterangan = String(request.keterangan || "").trim();
  const holdReference = request.holdTransactionId || request.realisasiHoldId || request.holdId || null;
  const holdCheck = validateHoldReference_(holdReference);
  if (!holdCheck.valid) return { success: false, status: "REJECTED", code: "HOLD_REFERENCE_REJECTED", requestId: request.requestId, error: holdCheck.error, writeOccurred: false };

  let transactionId;
  let nonce;
  try {
    transactionId = normalizeIdentity_(request.transactionId, "transactionId", false);
    nonce = normalizeIdentity_(request.nonce || transactionId, "nonce", !!request._syncMode);
    if (!transactionId) transactionId = nonce || ("TX-" + Utilities.formatDate(new Date(), TIMEZONE, "yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().substring(0, 8));
    if (!nonce) nonce = transactionId;
  } catch (e) {
    return { success: false, status: "REJECTED", code: "INVALID_IDENTITY", requestId: request.requestId, error: e.message, writeOccurred: false };
  }

  const client = request.client || {};
  const deviceId = String(client.deviceId || "").trim();
  const operation = request._syncMode ? "syncTransaction" : "addTransaction";
  const lock = LockService.getScriptLock();
  let ledgerRecord = null;
  let attempts = 0;
  let targetRow = -1;
  let writeTouched = false;
  let lastError = null;
  let success = false;
  let finalQty = numericQty;
  let keterangan = originalKeterangan;
  let shortageMode = false;
  let availableQtyAtDecision = null;
  let normalizationStatus = { success: true, mode: "NOT_REQUIRED" };
  const flags = [];

  try {
    if (!lock.tryLock(15000)) return { success: false, status: "UNKNOWN", code: "LOCK_TIMEOUT", requestId: request.requestId, transactionId: transactionId, nonce: nonce, writeOccurred: "unknown", error: "Lock backend tidak tersedia; lakukan read-back sebelum retry." };
    try {
      ledgerRecord = findIdempotencyRecord_(transactionId, nonce);
      if (ledgerRecord && !identityPayloadMatches_(ledgerRecord, { sheet: sheetName, entitas: entitas, kodeBarang: kode, qty: numericQty, tanggal: expectedDateKey })) {
        return { success: false, status: "CONFLICT", code: "IDENTITY_REUSE_CONFLICT", requestId: request.requestId, transactionId: transactionId, nonce: nonce, writeOccurred: false, error: "Identity sudah pernah dipakai untuk payload berbeda." };
      }
      if (ledgerRecord) {
        const priorRead = readBackTransactionByIdentity_({ transactionId: transactionId, nonce: nonce }, sheetName);
        if (priorRead.matched) {
          ledgerRecord = updateIdempotencyRecord_(ledgerRecord, { status: "APPLIED", dataRow: priorRead.row, writeOccurred: true, errorCode: "" });
          return { success: true, status: "APPLIED", code: "IDEMPOTENT_REPLAY", requestId: request.requestId, transactionId: transactionId, nonce: nonce, sheet: sheetName, row: priorRead.row, kode: kode, qty: priorRead.qty, originalQty: numericQty, readBack: priorRead, replayed: true };
        }
        if (ledgerRecord.status === "UNKNOWN" || ledgerRecord.writeOccurred === "unknown") {
          return { success: false, status: "UNKNOWN", code: "READBACK_REQUIRED", requestId: request.requestId, transactionId: transactionId, nonce: nonce, writeOccurred: "unknown", error: "Identity memiliki percobaan ambigu; gunakan getTransactionStatus sebelum retry." };
        }
        ledgerRecord = updateIdempotencyRecord_(ledgerRecord, { status: "IN_PROGRESS", requestId: request.requestId, deviceId: deviceId, errorCode: "", writeOccurred: false });
      } else {
        ledgerRecord = appendIdempotencyRecord_({ transactionId: transactionId, nonce: nonce, requestId: request.requestId, deviceId: deviceId, operation: operation, sheet: sheetName, entitas: entitas, kodeBarang: kode, qty: numericQty, tanggal: expectedDateKey, status: "IN_PROGRESS", writeOccurred: false, details: "Claimed before write" });
      }

      const stockInfo = getStockByCode(kode, entitas);
      if (!stockInfo || !stockInfo.success) throw new Error("Kode Barang Tidak Dikenal atau entitas tidak cocok: " + kode);
      if (sheetName === "Barang keluar" && numericQty > 0) {
        const sisa = Math.max(0, Number(stockInfo.stockAkhir) || 0);
        availableQtyAtDecision = sisa;
        const kekurangan = Math.max(0, numericQty - sisa);
        if (kekurangan > 0) {
          shortageMode = true;
          finalQty = 0;
          const unit = String(stockInfo.satuan || "").trim().toLowerCase();
          const structured = String(numericQty) + (unit ? " " + unit : "") + " masih pending stock 0";
          keterangan = keterangan ? (keterangan + " | " + structured) : structured;
          flags.push("STOCK_KURANG", "STOCK_KURANG_HOLD", "QTY_HOLD_0");
          try {
            MailApp.sendEmail(ADMIN_EMAIL, "[GudangAI][STOCK KURANG] " + kode + " " + (stockInfo.nama || ""),
              "Entitas: " + entitas + "\nItem: " + kode + " â€” " + (stockInfo.nama || "") + "\nOrder keluar: " + numericQty + "\nStok tersedia: " + sisa + "\nKekurangan: " + kekurangan + "\n\nHOLD: Qty transaksi ditulis 0.");
          } catch (mailErr) { console.error("Email stock kurang gagal: " + mailErr.message); }
        }
      }
      // Identitas disimpan di Idempotency Ledger/System Log, bukan di Keterangan.
      // Keterangan normal tetap kosong; Keterangan shortage/eksplisit dipertahankan.
      keterangan = String(keterangan || "").trim().substring(0, MAX_KETERANGAN_LENGTH);

      while (attempts < MAX_RETRY && !success) {
        attempts++;
        try {
          targetRow = findSafeEmptyRowAdaptively(sheet, config);
          if (!verifyRowStillEmptyPath2(sheet, targetRow)) throw new Error("Baris target " + targetRow + " terisi proses paralel.");
          // Hanya kolom writable: B:C dan F:G. Kolom D:E tetap terlindungi.
          sheet.getRange(targetRow, 2, 1, 2).setValues([[formattedDate, kode]]);
          writeTouched = true;
          sheet.getRange(targetRow, 6, 1, 2).setValues([[finalQty, keterangan]]);
          if (!shortageMode) normalizationStatus = enforceNonNegativeStock_(kode);
          SpreadsheetApp.flush();
          const vBC = sheet.getRange(targetRow, 2, 1, 2).getValues()[0];
          const vFG = sheet.getRange(targetRow, 6, 1, 2).getValues()[0];
          if (normalizeTransactionDateKey_(vBC[0]) !== expectedDateKey || String(vBC[1] || "").trim() !== kode || Number(vFG[0]) !== finalQty || String(vFG[1] || "") !== keterangan) {
            throw new Error("Verifikasi integritas gagal di baris " + targetRow + ".");
          }
          success = true;
        } catch (err) {
          lastError = err;
          if (!shouldRetryWrite_(writeTouched)) break;
          if (attempts < MAX_RETRY) Utilities.sleep(Math.pow(2, attempts) * 1000);
        }
      }
    } finally {
      if (lock.hasLock()) lock.releaseLock();
    }
  } catch (outerErr) {
    lastError = outerErr;
  }

  const execMs = Date.now() - t0;
  if (success) {
    // Final success wajib ditopang oleh read-back identitas, bukan hanya setValues/flush.
    const readBack = readBackTransactionByRow_(sheetName, targetRow, { transactionId: transactionId, nonce: nonce });
    if (!readBack.matched) {
      const readBackError = "Write menyentuh Sheet tetapi row belum terkonfirmasi melalui read-back; jangan retry sebelum getTransactionStatus.";
      if (ledgerRecord) updateIdempotencyRecord_(ledgerRecord, { status: "UNKNOWN", dataRow: targetRow, writeOccurred: true, errorCode: "READBACK_REQUIRED", details: readBackError });
      writeAuditLogSecure("WRITE_TRANSACTION", "UNKNOWN", { requestId: request.requestId, transactionId: transactionId, nonce: nonce, deviceId: deviceId, sheet: sheetName, row: targetRow, entitas: entitas, kode: kode, qty: finalQty, writeOccurred: true }, readBackError, transactionId);
      return { success: false, status: "UNKNOWN", code: "READBACK_REQUIRED", requestId: request.requestId, transactionId: transactionId, nonce: nonce, sheet: sheetName, row: targetRow, entitas: entitas, kode: kode, qty: finalQty, writeOccurred: true, retryable: false, readBack: readBack, error: readBackError };
    }
    ledgerRecord = updateIdempotencyRecord_(ledgerRecord, { status: "APPLIED", dataRow: readBack.row, writeOccurred: true, errorCode: "", details: JSON.stringify({ shortage: shortageMode, attempts: attempts, execMs: execMs }) });
    writeAuditLogSecure("WRITE_TRANSACTION", "SUCCESS", { requestId: request.requestId, transactionId: transactionId, nonce: nonce, deviceId: deviceId, sheet: sheetName, row: readBack.row, entitas: entitas, kode: kode, qty: finalQty, originalQty: numericQty, shortage: shortageMode, retries: attempts - 1, execMs: execMs }, "", transactionId);
    if (shortageMode) writeAuditLogSecure("SHORTAGE_HOLD", "HOLD_CREATED", { requestId: request.requestId, transactionId: transactionId, nonce: nonce, entitas: entitas, kode: kode, orderQty: numericQty, availableQty: availableQtyAtDecision == null ? 0 : availableQtyAtDecision, holdQty: 0, keterangan: keterangan }, "", transactionId);
    else if (holdReference) writeAuditLogSecure("HOLD_REALIZATION", "REALIZED", { holdTransactionId: holdReference, realizationTransactionId: transactionId, entitas: entitas, kode: kode, qty: finalQty }, "", transactionId);
    updateLastUpdateTimestamp();
    clearMasterCache();
    return { success: true, status: "APPLIED", code: "TRANSACTION_APPLIED", requestId: request.requestId, transactionId: transactionId, nonce: nonce, sheet: sheetName, row: readBack.row, entitas: entitas, kode: kode, qty: finalQty, originalQty: numericQty, shortage: shortageMode, stockPolicy: shortageMode ? "STOCK_KURANG_HOLD_QTY_0" : "NORMAL", normalization: normalizationStatus, holdTransactionId: holdReference || null, flags: flags, retries: attempts - 1, execMs: execMs, writeOccurred: true, readBack: readBack, message: shortageMode ? "HOLD: Qty ditulis 0; keterangan ringkas mencatat order dan kekurangan." : "Transaksi berhasil di " + sheetName + " baris " + readBack.row + "." };
  }

  const possible = writeTouched ? "unknown" : false;
  const status = writeTouched ? "UNKNOWN" : "FAILED";
  const code = writeTouched ? "PARTIAL_WRITE_READBACK_REQUIRED" : "WRITE_FAILED";
  const errorText = lastError ? String(lastError.message || lastError) : "Kesalahan tidak diketahui";
  if (ledgerRecord) updateIdempotencyRecord_(ledgerRecord, { status: status, dataRow: targetRow > 0 ? targetRow : "", writeOccurred: possible, errorCode: code, details: errorText });
  if (writeTouched) {
    const rb = readBackTransactionByRow_(sheetName, targetRow, { transactionId: transactionId, nonce: nonce });
    if (rb.matched) {
      const finalRec = ledgerRecord ? updateIdempotencyRecord_(ledgerRecord, { status: "APPLIED", dataRow: rb.row, writeOccurred: true, errorCode: "" }) : null;
      return { success: true, status: "APPLIED", code: "READBACK_CONFIRMED_AFTER_ERROR", requestId: request.requestId, transactionId: transactionId, nonce: nonce, sheet: sheetName, row: rb.row, entitas: entitas, kode: kode, qty: rb.qty, writeOccurred: true, readBack: rb, ledger: finalRec };
    }
  }
  try { sendErrorEmailWithCooldown("addTransaction - " + sheetName, lastError, { requestId: request.requestId, transactionId: transactionId, nonce: nonce, sheet: sheetName, entitas: entitas, kodeBarang: kode, qty: numericQty, tanggal: formattedDate }); } catch (notifyErr) {}
  writeAuditLogSecure("WRITE_TRANSACTION", status, { requestId: request.requestId, transactionId: transactionId, nonce: nonce, sheet: sheetName, entitas: entitas, kode: kode, qty: numericQty, writeTouched: writeTouched }, errorText, transactionId);
  return { success: false, status: status, code: code, requestId: request.requestId, transactionId: transactionId, nonce: nonce, sheet: sheetName, entitas: entitas, kode: kode, qty: numericQty, writeOccurred: possible, retryable: !writeTouched, error: writeTouched ? "Status tidak pasti; lakukan getTransactionStatus sebelum retry." : errorText };
}

function bulkTransaction(body) {
  if (body && (body._syncMode || body.offlineContext || body.operation === "syncTransaction") && body.queueApproved !== true) {
    return { success: false, status: "REJECTED", code: "QUEUE_APPROVAL_REQUIRED", batchId: body.batchId || null, error: "queueApproved=true wajib untuk bulk outbox." };
  }
  if (!body || !Array.isArray(body.transactions) || body.transactions.length === 0) {
    return { success: false, error: "transactions array kosong" };
  }
  if (body.transactions.length > 200) {
    return { success: false, error: "Batch melebihi batas 200 transaksi" };
  }

  const batchId = String(body.batchId || body.transactionId || body.nonce || ("BATCH-" + Utilities.getUuid())).trim();
  const batchCache = CacheService.getScriptCache();
  const cachedBatch = batchCache.get("batchResult_" + batchId);
  if (cachedBatch) {
    try {
      const previous = JSON.parse(cachedBatch);
      previous.replayed = true;
      return previous;
    } catch (e) {
      batchCache.remove("batchResult_" + batchId);
    }
  }

  // Preflight wajib: tidak boleh ada satu pun write sebelum seluruh batch valid.
  const prepared = [];
  const validationErrors = [];
  const seenKeys = {};
  for (let i = 0; i < body.transactions.length; i++) {
    const original = body.transactions[i];
    const tx = Object.assign({}, original);
    if (!tx.sheet) tx.sheet = body.sheet;
    if (!tx.entitas) tx.entitas = body.entitas;
    if (tx.queueApproved !== true && body.queueApproved === true) tx.queueApproved = true;
    if (!tx.client && body.client) tx.client = body.client;
    if (!tx._syncMode && body._syncMode) tx._syncMode = true;
    tx.transactionId = String(tx.transactionId || (batchId + "-" + String(i + 1).padStart(3, "0")));
    const check = validateTransactionRequest_(tx, { requireDate: !!tx._syncMode, requireEntity: true });
    if (!check.valid) {
      validationErrors.push({ index: i + 1, error: check.error });
      continue;
    }
    const normalizedKode = String(check.kode || tx.kodeBarang || tx.kode || "").trim();
    const duplicateKey = String(tx.sheet) + "|" + normalizedKode + "|" + String(tx.qty);
    if (seenKeys[duplicateKey]) {
      validationErrors.push({ index: i + 1, error: "Duplikat item dalam batch: " + normalizedKode + " qty " + tx.qty });
      continue;
    }
    seenKeys[duplicateKey] = true;
    tx.kodeBarang = normalizedKode;
    // Jangan menambahkan namaBarang/satuan ke payload write; kolom tersebut diproteksi.
    prepared.push(tx);
  }
  if (validationErrors.length > 0) {
    const rejected = { success: false, status: "PRECHECK_REJECTED", batchId: batchId, total: body.transactions.length, validationErrors: validationErrors, results: [] };
    batchCache.put("batchResult_" + batchId, JSON.stringify(rejected), DUP_CACHE_TTL_SEC);
    return rejected;
  }

  const results = [];
  let successCount = 0, failCount = 0;
  for (let i = 0; i < prepared.length; i++) {
    const result = addTransaction(prepared[i]);
    result.batchId = batchId;
    result.batchIndex = i + 1;
    results.push(result);
    if (result.success) successCount++; else failCount++;
    if (failCount > 0) break;
  }

  const response = {
    success: failCount === 0 && successCount === prepared.length,
    status: failCount === 0 ? "COMMITTED" : "PARTIAL_FAILURE_REVIEW_REQUIRED",
    batchId: batchId,
    total: prepared.length,
    successCount: successCount,
    failCount: failCount,
    results: results
  };
  batchCache.put("batchResult_" + batchId, JSON.stringify(response), DUP_CACHE_TTL_SEC);
  writeAuditLogSecure("BULK_TRANSACTION", response.success ? "SUCCESS" : "PARTIAL_FAILURE", { batchId: batchId, total: prepared.length, successCount: successCount, failCount: failCount }, response.success ? "" : "Jangan ulangi batch sebelum review.", batchId);
  return response;
}

function validateTransactionRequest_(tx, options) {
  const opts = options || {};
  if (!tx || typeof tx !== "object") return { valid: false, status: "REJECTED", code: "INVALID_TRANSACTION", error: "Transaksi tidak valid" };
  const sheetName = String(tx.sheet || "");
  if (!(sheetName in SHEET_CONFIG)) return { valid: false, status: "REJECTED", code: "SHEET_NOT_ALLOWED", error: "Sheet tidak diizinkan: " + tx.sheet };
  if (Object.prototype.hasOwnProperty.call(tx, "namaBarang") || Object.prototype.hasOwnProperty.call(tx, "nama") || Object.prototype.hasOwnProperty.call(tx, "satuan")) {
    return { valid: false, status: "REJECTED", code: "PROTECTED_FIELD", error: "Kolom Nama Barang/Satuan diproteksi; kirim hanya tanggal, kodeBarang, qty, dan keterangan." };
  }
  const allowed = ["action", "operation", "schemaVersion", "sheet", "entitas", "kodeBarang", "qty", "tanggal", "keterangan", "transactionId", "nonce", "holdTransactionId", "realisasiHoldId", "holdId", "requestId", "queueApproved", "client", "offlineContext", "secret", "_syncMode", "batchId", "deviceId"];
  const unknown = Object.keys(tx).filter(function(k) { return allowed.indexOf(k) < 0 && k !== "payload"; });
  if (unknown.length) return { valid: false, status: "REJECTED", code: "UNKNOWN_FIELD", error: "Field tidak diizinkan: " + unknown.join(", ") };
  const entitas = String(tx.entitas || "").trim().toUpperCase();
  if (opts.requireEntity !== false && ["CV", "PT"].indexOf(entitas) < 0) return { valid: false, status: "REJECTED", code: "ENTITY_REQUIRED", error: "entitas wajib CV atau PT." };
  const kode = String(tx.kodeBarang || "").trim();
  if (!kode) return { valid: false, status: "REJECTED", code: "CODE_REQUIRED", error: "kodeBarang wajib diisi" };
  const qty = Number(tx.qty);
  if (isNaN(qty) || qty < 0 || qty > MAX_QTY) return { valid: false, status: "REJECTED", code: "INVALID_QTY", error: "qty tidak valid" };
  if (opts.requireDate && !tx.tanggal) return { valid: false, status: "REJECTED", code: "DATE_REQUIRED", error: "tanggal wajib diisi untuk sinkronisasi outbox." };
  if (tx.tanggal) {
    const dateCheck = validateTransactionDate(tx.tanggal);
    if (!dateCheck.valid) return { valid: false, status: "REJECTED", code: "INVALID_DATE", error: dateCheck.error };
  }
  const stock = getStockByCode(kode, entitas);
  if (!stock || !stock.success) return { valid: false, status: "REJECTED", code: "CODE_ENTITY_MISMATCH", error: "Kode Barang Tidak Dikenal atau entitas tidak cocok: " + kode };
  if (String(stock.entitas || "").toUpperCase() !== entitas) return { valid: false, status: "REJECTED", code: "ENTITY_MISMATCH", error: "Entitas tidak cocok untuk " + kode };
  return { valid: true, status: "VALIDATED", kode: kode, nama: stock.nama || "", entitas: stock.entitas, stockAkhir: stock.stockAkhir };
}



// ============================================================
// 5. RESOLVE NAMA â†’ KODE [V6.2]
// ============================================================
function resolveKodeFromNama(namaInput) {
  const namaLower = String(namaInput).toLowerCase().trim();
  if (!namaLower) return { success: false, error: "Nama kosong" };

  if (SPECIAL_NAME_MAP[namaLower]) {
    return { success: true, kode: SPECIAL_NAME_MAP[namaLower], nama: namaInput, confidence: "100%", flags: ["SPECIAL_MAP"] };
  }

  const all = getAllStock("ALL");
  if (!all.success) return { success: false, error: "Gagal baca master" };

  const exact = all.items.filter(i => String(i.nama).toLowerCase().trim() === namaLower);
  if (exact.length === 1) return { success: true, kode: exact[0].kode, nama: exact[0].nama, confidence: "100%" };
  if (exact.length > 1) {
    return { success: false, error: "Nama ambigu: " + exact.map(i => i.kode).join(", "), flags: ["AMBIGUOUS_EXACT"], candidates: exact };
  }

  const fuzzy = all.items.filter(i => {
    const n = String(i.nama).toLowerCase();
    return n.includes(namaLower) || namaLower.includes(n);
  });
  if (fuzzy.length === 1) return { success: true, kode: fuzzy[0].kode, nama: fuzzy[0].nama, confidence: "85%", flags: ["FUZZY_MATCH"] };
  if (fuzzy.length > 1) {
    return { success: false, error: "Beberapa nama mirip. Konfirmasi kode.", flags: ["AMBIGUOUS_SIMILAR"], candidates: fuzzy.map(i => ({ kode: i.kode, nama: i.nama })) };
  }
  return { success: false, error: "Nama tidak ditemukan: \"" + namaInput + "\". STOP.", confidence: "0%" };
}


// ============================================================
// 6. ROW FINDING + VERIFY [V6.0 robust version]
// ============================================================
function getRealLastDataRow(sheet, config) {
  const startRow = config.headerRow + 1;
  const totalRows = sheet.getMaxRows();
  if (totalRows < startRow) return startRow - 1;
  const numRows = totalRows - startRow + 1;
  const kodeColValues = sheet.getRange(startRow, config.kodeColAbsolute, numRows, 1).getValues();
  for (let i = kodeColValues.length - 1; i >= 0; i--) {
    if (kodeColValues[i][0] !== "" && kodeColValues[i][0] !== null) {
      return startRow + i;
    }
  }
  return startRow - 1;
}

function findSafeEmptyRowAdaptively(sheet, config) {
  const realLastRow = getRealLastDataRow(sheet, config);
  const startRow = Math.max(config.headerRow + 1, realLastRow - SCAN_BUFFER_ROWS);
  const maxRows = sheet.getMaxRows();
  const scanEndRow = Math.min(maxRows, realLastRow + SCAN_BUFFER_ROWS);
  const numRowsToScan = Math.max(1, scanEndRow - startRow + 1);
  const bcValues = sheet.getRange(startRow, 2, numRowsToScan, 2).getValues();
  const fgValues = sheet.getRange(startRow, 6, numRowsToScan, 2).getValues();
  for (let i = 0; i < numRowsToScan; i++) {
    const leftEmpty = bcValues[i].every(function(cell) { return cell === "" || cell === null || cell === undefined; });
    const rightEmpty = fgValues[i].every(function(cell) { return cell === "" || cell === null || cell === undefined; });
    if (leftEmpty && rightEmpty) return startRow + i;
  }
  const appendRow = realLastRow + 1;
  if (appendRow > maxRows) {
    try {
      sheet.insertRowsAfter(maxRows, 100);
    } catch (insertErr) {
      try { sheet.insertRows(maxRows + 1, 100); }
      catch (insertErr2) {
        throw new Error("[V6.3] Gagal tambah baris di '" + sheet.getName() + "'. Proteksi sheet-level? Tambah baris manual atau buka proteksi. Error: " + insertErr.message);
      }
    }
  }
  return appendRow;
}

function isRowEmpty(row) {
  return row.every(function(cell) { return cell === "" || cell === null || cell === undefined; });
}

function shouldRetryWrite_(writeTouched) {
  return !writeTouched;
}

function verifyRowStillEmptyPath2(sheet, row) {
  const bc = sheet.getRange(row, 2, 1, 2).getValues()[0];
  const fg = sheet.getRange(row, 6, 1, 2).getValues()[0];
  return (bc[0] === "" || bc[0] === null) && (bc[1] === "" || bc[1] === null) &&
         (fg[0] === "" || fg[0] === null) && (fg[1] === "" || fg[1] === null);
}


// ============================================================
// 7. DEDUP [V6.0]
// ============================================================
function isHoldReferenceAlreadyRealized_(holdId) {
  const target = String(holdId || "").trim();
  if (!target) return false;
  const log = getSS().getSheetByName("System Log");
  if (!log || log.getLastRow() < 2) return false;
  const rows = log.getRange(2, 2, log.getLastRow() - 1, 4).getValues();
  return rows.some(function(row) {
    const action = String(row[1] || "");
    const details = String(row[3] || "");
    return action === "HOLD_REALIZATION" && details.indexOf(target) >= 0;
  });
}

function validateHoldReference_(holdId) {
  const target = String(holdId || "").trim();
  if (!target) return { valid: true, holdId: null };
  const log = getSS().getSheetByName("System Log");
  if (!log || log.getLastRow() < 2) return { valid: false, error: "Referensi HOLD tidak ditemukan: " + target };
  const rows = log.getRange(2, 2, log.getLastRow() - 1, 5).getValues();
  let foundHold = false;
  rows.forEach(function(row) {
    const txId = String(row[0] || "");
    const action = String(row[1] || "");
    const status = String(row[2] || "");
    const details = String(row[3] || "");
    if (txId === target && action === "SHORTAGE_HOLD" && status === "HOLD_CREATED") foundHold = true;
  });
  if (!foundHold) return { valid: false, error: "Transaction HOLD tidak valid atau tidak ditemukan: " + target };
  if (isHoldReferenceAlreadyRealized_(target)) return { valid: false, error: "HOLD sudah direalisasikan sebelumnya: " + target };
  return { valid: true, holdId: target };
}

function isDuplicate(kode, qty, keterangan, sheetName) {
  const cache = CacheService.getScriptCache();
  const scope = String(sheetName || "").trim();
  const normalizedKode = String(kode || "").trim();
  const normalizedQty = String(qty == null ? "" : qty).trim();
  const normalizedKeterangan = String(keterangan || "").trim();
  const rawKey = [scope, normalizedKode, normalizedQty, normalizedKeterangan].join("|");
  let digestKey = rawKey.replace(/[^A-Za-z0-9_.:-]/g, "_").substring(0, 180);
  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawKey);
    digestKey = Utilities.base64EncodeWebSafe(digest).substring(0, 180);
  } catch (e) {}
  const key = "fingerprint60_" + digestKey;
  if (cache.get(key)) return true;
  cache.put(key, "1", 60);
  return false;
}

function isDuplicateTransaction(sheetName, kode, qty, nonce) {
  const cache = CacheService.getScriptCache();
  const fingerprint = String(sheetName || "") + "|" + String(kode || "") + "|" + String(qty == null ? "" : qty);
  const nonceText = String(nonce || "").trim();
  const cacheKey = nonceText
    ? "dedup_nonce_" + nonceText.replace(/[^A-Za-z0-9_.:-]/g, "_").substring(0, 180)
    : "dedup_fp_" + fingerprint.replace(/[^A-Za-z0-9_.:-]/g, "_").substring(0, 180);
  if (cache.get(cacheKey)) return true;

  // Durable ledger is authoritative for current requests and ambiguous writes.
  if (nonceText) {
    try {
      const rec = findIdempotencyRecord_(nonceText, nonceText);
      if (rec && (rec.status === "APPLIED" || rec.status === "UNKNOWN" || rec.writeOccurred === "true" || rec.writeOccurred === "unknown")) return true;
    } catch (e) { console.warn("Dedup ledger fallback gagal: " + e.message); }
    // Backward-compatible fallback for older System Log INTENT/SUCCESS records.
    try {
      const log = getSS().getSheetByName("System Log");
      if (log && log.getLastRow() >= 2) {
        const rows = log.getRange(2, 2, log.getLastRow() - 1, 4).getValues();
        const needle = '"clientNonce":"' + nonceText.replace(/"/g, '\\"') + '"';
        if (rows.some(function(row) { return String(row[3] || "").indexOf(needle) >= 0; })) return true;
      }
    } catch (e) { console.warn("Dedup audit fallback gagal: " + e.message); }
  }

  cache.put(cacheKey, "seen", DUP_CACHE_TTL_SEC);
  return false;
}



// ============================================================
// 8. MASTER DATA CACHE [V6.0]
// ============================================================
function lookupMasterDataCached(kode) {
  const map = getMasterMap();
  return map[kode] || null;
}

function getMasterMap() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("masterMap");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  return rebuildAndCacheMasterMap();
}

function rebuildAndCacheMasterMap() {
  const ss = getSS();
  const map = {};
  ["Stock CV", "Stock PT"].forEach(function(sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 4) return;
    const data = sheet.getRange(4, 2, lastRow - 3, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      const kode = String(data[i][0] || "").trim();
      if (kode && !kode.startsWith("Total")) {
        map[kode] = { nama: data[i][1], satuan: data[i][2], rowIndex: i + 4, sheet: sheetName };
      }
    }
  });
  try {
    CacheService.getScriptCache().put("masterMap", JSON.stringify(map), MASTER_CACHE_TTL_SEC);
  } catch (e) {}
  return map;
}

function clearMasterCache() {
  try { CacheService.getScriptCache().removeAll(["masterMap"]); } catch (e) {}
  _cachedSS = null;
  _resolvedSpreadsheetId = null;
  return { success: true, message: "Cache master dibersihkan." };
}


// ============================================================
// 9. STOCK API [V6.0 + V6.2 merged]
// ============================================================
function clampStockToZero_(value) {
  const n = Number(value);
  return isNaN(n) || n < 0 ? 0 : n;
}

/**
 * Menormalkan Stock Akhir pada sumber Stock CV/PT.
 * Formula asli dipertahankan dengan pembungkus MAX(0, formula).
 * ArrayFormula/spill tidak disentuh; jalur read API tetap melakukan clamp.
 */
function diagnoseStockFormulaPatterns_() {
  const ss = getSS();
  const sheets = ["Stock CV", "Stock PT"];
  const result = { success: true, generatedAt: new Date().toISOString(), sheets: [] };
  sheets.forEach(function(name) {
    const sh = ss.getSheetByName(name);
    const entry = { sheet: name, exists: !!sh, rows: 0, stockAkhirColumn: null, patterns: { rowFormula: 0, arrayFormulaAnchor: 0, value: 0, protected: 0, negativeValues: 0 }, samples: [] };
    if (!sh || sh.getLastRow() < 4) { result.sheets.push(entry); return; }
    entry.rows = sh.getLastRow() - 3;
    const headers = sh.getRange(3, 1, 1, sh.getLastColumn()).getValues()[0];
    const cAkhir = headers.findIndex(function(h) { return String(h).toLowerCase().trim().includes("stock akhir"); }) + 1;
    entry.stockAkhirColumn = cAkhir || null;
    if (!cAkhir) { result.sheets.push(entry); return; }
    const values = sh.getRange(4, cAkhir, entry.rows, 1).getValues();
    const formulas = sh.getRange(4, cAkhir, entry.rows, 1).getFormulas();
    for (let i = 0; i < entry.rows; i++) {
      const formula = formulas[i][0];
      const value = Number(values[i][0]);
      if (formula && /ARRAYFORMULA/i.test(formula)) entry.patterns.arrayFormulaAnchor++;
      else if (formula) entry.patterns.rowFormula++;
      else entry.patterns.value++;
      if (!isNaN(value) && value < 0) entry.patterns.negativeValues++;
      if (entry.samples.length < 5 && (formula || (!isNaN(value) && value < 0))) {
        entry.samples.push({ row: i + 4, formula: formula || null, value: values[i][0], protected: isProtectedCell_(sh, i + 4, cAkhir) });
      }
      if (isProtectedCell_(sh, i + 4, cAkhir)) entry.patterns.protected++;
    }
    result.sheets.push(entry);
  });
  return result;
}

function isProtectedCell_(sheet, row, column) {
  try {
    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE) || [];
    return protections.some(function(protection) {
      const range = protection.getRange();
      return row >= range.getRow() && row < range.getRow() + range.getNumRows() &&
             column >= range.getColumn() && column < range.getColumn() + range.getNumColumns();
    });
  } catch (e) {
    return false;
  }
}

function wrapFormulaNonNegative_(formula) {
  // Deprecated compatibility helper: formula existing dikembalikan apa adanya.
  // Tidak ada pembentukan atau penulisan formula otomatis pada Stock CV/PT.
  return String(formula || "").trim();
}

function enforceNonNegativeStock_(kode) {
  // Fail-closed: fungsi ini sengaja tidak menulis formula atau nilai ke Stock CV/PT.
  // Formula/master spreadsheet utama hanya boleh diubah atas instruksi khusus operator.
  const targetKode = String(kode || "").trim();
  return {
    success: true,
    mode: "READ_ONLY_FORMULA_PRESERVED",
    kode: targetKode,
    writePerformed: false,
    message: "Formula dan nilai Stock Akhir dipertahankan; tidak ada normalisasi otomatis."
  };
}

function getStockByCode(kode, requestedEntitas) {
  const normalizedKode = String(kode || "").trim();
  const requestedEntity = String(requestedEntitas || "").trim().toUpperCase();
  if (!normalizedKode) return { success: false, error: "Kode kosong" };

  const masterData = lookupMasterDataCached(normalizedKode);
  if (!masterData) {
    // Fallback wajib: gunakan sumber header-based yang sama dengan getAllStock.
    const all = getAllStock("ALL");
    const found = all.success && all.items.find(function(item) {
      return String(item.kode || "").trim() === normalizedKode;
    });
    if (!found) return { success: false, error: "Kode tidak ditemukan: " + normalizedKode };
    if (requestedEntity && String(found.entitas || "").toUpperCase() !== requestedEntity) return { success: false, error: "Entitas tidak cocok untuk " + normalizedKode };
    return {
      success: true,
      kode: found.kode,
      nama: found.nama,
      satuan: found.satuan,
      stockAkhir: clampStockToZero_(found.stockAkhir),
      stockAman: found.stockAman,
      stockValue: found.stockValue,
      divisi: found.divisi,
      entitas: found.entitas
    };
  }

  const ss = getSS();
  const sheet = ss.getSheetByName(masterData.sheet);
  if (!sheet) return { success: false, error: "Sheet master hilang: " + masterData.sheet };

  const headers = sheet.getRange(3, 1, 1, sheet.getLastColumn()).getValues()[0];
  let rowVals = sheet.getRange(masterData.rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Self-healing: cek apakah kode di rowIndex masih benar
  const kodeCol = headers.findIndex(h => String(h).toLowerCase().includes("kode"));
  if (kodeCol >= 0 && String(rowVals[kodeCol]).trim() !== normalizedKode) {
    clearMasterCache();
    const freshMap = rebuildAndCacheMasterMap();
    if (!freshMap[normalizedKode]) return { success: false, error: "Kode hilang dari master setelah refresh: " + normalizedKode };
    rowVals = sheet.getRange(freshMap[normalizedKode].rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  const result = { success: true, kode: normalizedKode, entitas: masterData.sheet === "Stock CV" ? "CV" : "PT" };
  if (requestedEntity && result.entitas !== requestedEntity) return { success: false, error: "Entitas tidak cocok untuk " + normalizedKode };
  headers.forEach(function(h, idx) {
    const key = String(h).toLowerCase().trim();
    if (key.includes("nama")) result.nama = rowVals[idx];
    if (key.includes("satuan")) result.satuan = rowVals[idx];
    if (key.includes("stock akhir")) result.stockAkhir = clampStockToZero_(rowVals[idx]);
    if (key.includes("stock aman")) result.stockAman = rowVals[idx];
    if (key.includes("stock awal")) result.stockAwal = rowVals[idx];
  });
  return result;
}

function getAllStock(entitas) {
  const ss = getSS();
  const sheets = entitas === "CV" ? ["Stock CV"] : entitas === "PT" ? ["Stock PT"] : ["Stock CV", "Stock PT"];
  const items = [];

  sheets.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const headerRow = 3;
    const last = sheet.getLastRow();
    if (last <= headerRow) return;
    const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    const data = sheet.getRange(headerRow + 1, 1, last - headerRow, sheet.getLastColumn()).getValues();
    const label = name === "Stock CV" ? "CV" : "PT";

    data.forEach(function(row) {
      const kode = String(row[headers.findIndex(h => String(h).toLowerCase().includes("kode"))] || "").trim();
      if (!kode || kode.startsWith("Total")) return;
      const item = { kode: kode, entitas: label };
      headers.forEach(function(h, idx) {
        const key = String(h).toLowerCase().trim();
        if (key.includes("nama")) item.nama = row[idx];
        if (key.includes("satuan")) item.satuan = row[idx];
        if (key.includes("stock akhir")) item.stockAkhir = clampStockToZero_(row[idx]);
        if (key.includes("stock aman")) item.stockAman = row[idx];
        if (key.includes("stock value") || key.includes("nilai stok") || key.includes("nilai stock") || key.includes("value")) item.stockValue = row[idx];
        if (key.includes("divisi")) item.divisi = row[idx];
      });
      items.push(item);
    });
  });

  return { success: true, count: items.length, items: items };
}

function getLowStock() {
  const all = getAllStock("ALL");
  if (!all.success) return all;
  const low = all.items.filter(function(i) {
    const akhir = Number(i.stockAkhir) || 0;
    const aman = Number(i.stockAman) || 0;
    return aman > 0 && akhir < aman;
  });
  low.sort(function(a, b) { return (Number(a.stockAkhir) || 0) - (Number(b.stockAkhir) || 0); });
  return { success: true, count: low.length, items: low };
}

function getTransactionHistory(params) {
  const sheetName = params.sheet || "Barang keluar";
  if (!(sheetName in SHEET_CONFIG)) return { success: false, error: "Sheet tidak valid" };
  const config = SHEET_CONFIG[sheetName];
  const sheet = getSS().getSheetByName(sheetName);
  if (!sheet) return { success: false, error: "Sheet tidak ditemukan" };
  const last = getRealLastDataRow(sheet, config);
  if (last < config.headerRow + 1) return { success: true, count: 0, data: [] };
  const numRows = last - config.headerRow;
  const data = sheet.getRange(config.headerRow + 1, 1, numRows, sheet.getLastColumn()).getValues();
  const limit = params.limit ? Math.min(Number(params.limit), data.length) : data.length;
  const result = data.slice(-limit).reverse().map(function(row, index) {
    const note = String(row[6] || "");
    const txMatch = note.match(/GUDANGAI_TX=([^;|]+)/);
    const nonceMatch = note.match(/GUDANGAI_NONCE=([^;|]+)/);
    return { row: last - index, tanggal: row[1], kode: row[2], nama: row[3], satuan: row[4], qty: row[5], keterangan: row[6], transactionId: txMatch ? txMatch[1] : null, nonce: nonceMatch ? nonceMatch[1] : (txMatch ? txMatch[1] : null) };
  });
  return { success: true, count: result.length, data: result };
}

function searchByName(q) {
  if (!q) return { success: false, error: "Query kosong" };
  const all = getAllStock("ALL");
  if (!all.success) return all;
  const qLow = q.toLowerCase();
  const found = all.items.filter(function(i) {
    return String(i.nama || "").toLowerCase().includes(qLow) || String(i.kode || "").toLowerCase().includes(qLow);
  });
  return { success: true, count: found.length, items: found };
}


// ============================================================
// 10. AUDIT LOG [V6.0] + FORMAT TABEL PERSISTEN
// ============================================================
function formatSystemLogSheet_(sheet) {
  if (!sheet) return;
  const lastRow = Math.max(1, sheet.getLastRow());
  if (sheet.getMaxColumns() < 6) sheet.insertColumnsAfter(sheet.getMaxColumns(), 6 - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, 6).setValues([["Timestamp", "TransactionID", "Aksi/Action", "Status", "Rincian/Details", "Pesan Error"]]);
  sheet.getRange(1, 1, 1, 6).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1F4E79").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 6).setVerticalAlignment("middle");
    sheet.getRange(2, 1, lastRow - 1, 4).setHorizontalAlignment("center");
    sheet.getRange(2, 5, lastRow - 1, 2).setHorizontalAlignment("left").setWrap(true);
  }
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 155); sheet.setColumnWidth(2, 190); sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 105); sheet.setColumnWidth(5, 360); sheet.setColumnWidth(6, 300);
  if (sheet.getFilter()) sheet.getFilter().remove();
  if (lastRow >= 1) sheet.getRange(1, 1, lastRow, 6).createFilter();
}

function formatDailySnapshotsSheet_(sheet) {
  if (!sheet) return;
  const lastRow = Math.max(1, sheet.getLastRow());
  if (sheet.getMaxColumns() < 7) sheet.insertColumnsAfter(sheet.getMaxColumns(), 7 - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, 7).setValues([["Tanggal", "Total Item", "Stabil", "Kritis", "Waspada", "Total Stok", "Catatan"]]);
  sheet.getRange(1, 1, 1, 7).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1F4E79").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 1).setNumberFormat("yyyy-mm-dd").setHorizontalAlignment("center");
    sheet.getRange(2, 2, lastRow - 1, 5).setNumberFormat("#,##0").setHorizontalAlignment("center");
    sheet.getRange(2, 7, lastRow - 1, 1).setHorizontalAlignment("left").setWrap(true);
    sheet.getRange(2, 1, lastRow - 1, 7).setVerticalAlignment("middle");
  }
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 110); sheet.setColumnWidth(2, 105); sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 90); sheet.setColumnWidth(5, 90); sheet.setColumnWidth(6, 110); sheet.setColumnWidth(7, 180);
  if (sheet.getFilter()) sheet.getFilter().remove();
  if (lastRow >= 1) sheet.getRange(1, 1, lastRow, 7).createFilter();
}

function formatOperationalSheets_() {
  const ss = getSS();
  formatSystemLogSheet_(ss.getSheetByName("System Log"));
  formatDailySnapshotsSheet_(ss.getSheetByName("Daily Snapshots"));
  const logSheets = ss.getSheets().filter(function(sheet) { return sheet.getName().indexOf("System Log Archive ") === 0; });
  logSheets.forEach(formatSystemLogSheet_);
}

function writeAuditLogSecure(action, status, details, errorMsg, txId) {
  try {
    const ss = getSS();
    let logSheet = ss.getSheetByName("System Log");
    if (!logSheet) {
      logSheet = ss.insertSheet("System Log");
      logSheet.appendRow(["Timestamp", "TransactionID", "Aksi/Action", "Status", "Rincian/Details", "Pesan Error"]);
    }
    const detailStr = redactSensitiveString_((typeof details === "object") ? JSON.stringify(details) : String(details || ""));
    logSheet.appendRow([
      Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
      txId || "", action, status,
      detailStr.substring(0, 5000),
      String(errorMsg || "").substring(0, 2000)
    ]);
    formatSystemLogSheet_(logSheet);
    maybeArchiveAuditLog();
  } catch (logErr) {
    console.error("writeAuditLogSecure gagal: " + logErr.message);
  }
}

function maybeArchiveAuditLog() {
  try {
    const ss = getSS();
    const logSheet = ss.getSheetByName("System Log");
    if (!logSheet) return;
    const rowCount = logSheet.getLastRow();
    if (rowCount < AUDIT_LOG_ARCHIVE_THRESHOLD) return;
    const archiveName = "System Log Archive " + Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM");
    let archiveSheet = ss.getSheetByName(archiveName);
    if (!archiveSheet) archiveSheet = ss.insertSheet(archiveName);
    const dataRange = logSheet.getRange(1, 1, rowCount, 6).getValues();
    archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, dataRange.length, 6).setValues(dataRange);
    formatSystemLogSheet_(archiveSheet);
    logSheet.clear();
    logSheet.appendRow(["Timestamp", "TransactionID", "Aksi/Action", "Status", "Rincian/Details", "Pesan Error"]);
    formatSystemLogSheet_(logSheet);
  } catch (e) { console.error("maybeArchiveAuditLog error: " + e.message); }
}


function redactSensitiveString_(value) {
  return String(value || "").replace(/("?(?:secret|apiSecret|api_secret|token|authorization)"?\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
}

// ============================================================
// 11. ERROR EMAIL WITH COOLDOWN [V6.0]
// ============================================================
function sendErrorEmailWithCooldown(location, error, body) {
  try {
    const cache = CacheService.getScriptCache();
    const bodyObj = (body && typeof body === "object") ? body : {};
    const identity = [bodyObj.transactionId || bodyObj.nonce || "", bodyObj.sheet || location, bodyObj.kodeBarang || "", bodyObj.qty == null ? "" : bodyObj.qty, bodyObj.tanggal || ""].join("|");
    const cooldownKey = ("errorEmail_" + location + "_" + identity).replace(/[^A-Za-z0-9_:-]/g, "_").substring(0, 240);
    const durableKey = ("emailSent_" + location + "_" + identity).replace(/[^A-Za-z0-9_:-]/g, "_").substring(0, 240);
    const props = PropertiesService.getScriptProperties();
    const sentAt = Number(props.getProperty(durableKey) || 0);
    if ((sentAt && Date.now() - sentAt < 24 * 60 * 60 * 1000) || cache.get(cooldownKey)) return;

    const bodyStr = redactSensitiveString_((typeof body === "object") ? JSON.stringify(body, null, 2) : String(body || ""));
    const errStack = (error && error.stack) ? error.stack : (error ? error.message : "Unknown error");

    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: "[GudangAI ERROR] " + location,
      body: "Lokasi: " + location + "\n\nError:\n" + errStack + "\n\nBody:\n" + bodyStr.substring(0, 3000)
    });
    props.setProperty(durableKey, String(Date.now()));
    cache.put(cooldownKey, "sent", Math.floor(COOLDOWN_EMAIL_MS / 1000));
  } catch (mailErr) {
    console.error("sendErrorEmailWithCooldown gagal: " + mailErr.message);
  }
}

// Compatibility alias retained from V6.4.4 SHORTAGE HOLD QTY 0.
// It delegates to the cooldown-safe implementation so errors cannot spam email.
function sendErrorEmail(title, err, body) {
  return sendErrorEmailWithCooldown(title, err, body || {});
}

// Header lookup helper retained for legacy agents and sheet utilities.
function getHeaderIndex(sheet, headerRow, headerName) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return -1;
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  const target = String(headerName || "").trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim().toLowerCase() === target) return i + 1;
  }
  return -1;
}


// ============================================================
// 12. SYNC DIVISION STOCK [V6.2]
// ============================================================
function syncDivisionStock() {
  const ss = getSS();
  const src = ss.getSheetByName("Stock awal");
  const dest = ss.getSheetByName("Data Stok Per Divisi");
  if (!src || !dest) return { success: false, error: "Sheet Stock awal / Data Stok Per Divisi tidak ditemukan" };

  const data = src.getDataRange().getValues();
  if (data.length < 2) return { success: false, error: "Stock awal kosong" };

  const header = data[0].map(h => String(h).toLowerCase().trim());
  const idxKode   = header.findIndex(h => h.includes("kode"));
  const idxNama   = header.findIndex(h => h.includes("nama"));
  const idxSatuan = header.findIndex(h => h.includes("satuan"));
  const idxDivisi = header.findIndex(h => h.includes("divisi"));
  if (idxKode === -1 || idxDivisi === -1) return { success: false, error: "Header Stock awal tidak lengkap" };

  // Map Sisa Stok dari Stock CV + PT
  const stockMap = {};
  ["Stock CV", "Stock PT"].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < 4) return;
    const hdr = sh.getRange(3, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).toLowerCase().trim());
    const cK = hdr.findIndex(h => h.includes("kode")) + 1;
    const cA = hdr.findIndex(h => h.includes("stock akhir")) + 1;
    if (cK === 0 || cA === 0) return;
    sh.getRange(4, 1, last - 3, sh.getLastColumn()).getValues().forEach(row => {
      const k = String(row[cK - 1] || "").trim();
      if (k && k.indexOf("Total") !== 0) stockMap[k] = clampStockToZero_(row[cA - 1]);
    });
  });

  const groups = { "DAPUR 1":[], "DAPUR 2":[], "MIE":[], "PACKING":[], "CS":[], "BAHAN BAKU":[], "REKANAN":[] };
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const kode = String(row[idxKode] || "").trim();
    if (!kode) continue;
    let div = String(row[idxDivisi] || "").trim().toUpperCase();
    if (kode.startsWith("BBCV-") || kode.startsWith("BBPT-")) div = "BAHAN BAKU";
    if (!groups[div]) continue;
    groups[div].push({
      kode, nama: idxNama !== -1 ? row[idxNama] : "", satuan: idxSatuan !== -1 ? row[idxSatuan] : "",
      divisi: div, sisaStok: stockMap[kode] !== undefined ? stockMap[kode] : 0,
      size: div === "CS" ? (SIZE_MAP_CS[kode] || "") : ""
    });
  }

  if (dest.getMaxRows() > 0 && dest.getMaxColumns() > 0) {
    dest.getRange(1, 1, dest.getMaxRows(), dest.getMaxColumns()).breakApart();
  }
  dest.clear();
  dest.getRange("A1").setValue("TABEL DATA STOK PER DIVISI â€” V6.3 (Real-time)").setFontWeight("bold").setFontSize(14).setHorizontalAlignment("left");
  dest.getRange("A2").setValue("Sisa Stok = Stock Akhir CV/PT | Update: " + Utilities.formatDate(new Date(), TIMEZONE, "dd-MMM-yyyy HH:mm:ss")).setFontStyle("italic").setFontSize(9).setHorizontalAlignment("left");

  const order = ["DAPUR 1","DAPUR 2","MIE","PACKING","CS","BAHAN BAKU","REKANAN"];
  let r = 4;
  order.forEach(div => {
    const items = groups[div] || [];
    const divisionRow = r;
    dest.getRange(divisionRow, 1, 1, 7).merge().setValue("DIVISI : " + div).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1F4E79").setHorizontalAlignment("left").setVerticalAlignment("middle");
    dest.setRowHeight(divisionRow, 26);
    r++;
    const totalRow = r;
    dest.getRange(totalRow, 1, 1, 7).merge().setValue("TOTAL PRODUK : " + items.length + " ITEM").setFontWeight("bold").setFontColor("#1F4E79").setBackground("#EAF2F8").setHorizontalAlignment("center").setVerticalAlignment("middle");
    dest.setRowHeight(totalRow, 21);
    r++;
    const isCS = div === "CS";
    const headers = isCS ? ["No","Kode Barang","Nama Barang","Satuan","Divisi","Sisa Stok","Size"]
                         : ["No","Kode Barang","Nama Barang","Satuan","Divisi","Sisa Stok","Keterangan"];
    const headerRow = r;
    dest.getRange(headerRow, 1, 1, 7).setValues([headers]).setFontWeight("bold").setBackground("#2E75B6").setFontColor("#FFFFFF").setVerticalAlignment("middle");
    dest.getRange(headerRow, 1).setHorizontalAlignment("center");
    dest.getRange(headerRow, 2, 1, 2).setHorizontalAlignment("left");
    dest.getRange(headerRow, 4, 1, 4).setHorizontalAlignment("center");
    r++;
    const dataStart = r;
    items.forEach((item, idx) => {
      dest.getRange(r, 1, 1, 7).setValues([[idx+1, item.kode, item.nama, item.satuan, item.divisi, item.sisaStok, isCS ? item.size : ""]]);
      r++;
    });
    if (items.length) {
      dest.getRange(dataStart, 1, items.length, 1).setHorizontalAlignment("center");
      dest.getRange(dataStart, 2, items.length, 2).setHorizontalAlignment("left").setWrap(true);
      dest.getRange(dataStart, 4, items.length, 3).setHorizontalAlignment("center");
      dest.getRange(dataStart, 7, items.length, 1).setHorizontalAlignment("center").setWrap(true);
    }
    r += 1;
  });
  dest.getRange(1, 1, Math.max(r, 4), 7).setVerticalAlignment("middle");
  dest.setFrozenRows(3);
  dest.setColumnWidth(1,50); dest.setColumnWidth(2,110); dest.setColumnWidth(3,280);
  dest.setColumnWidth(4,90); dest.setColumnWidth(5,120); dest.setColumnWidth(6,100); dest.setColumnWidth(7,240);

  updateLastUpdateTimestamp();
  const total = order.reduce((s,d) => s + (groups[d]||[]).length, 0);
  return { success: true, total: total, message: total + " item disinkronisasi ke 7 divisi." };
}


// ============================================================
// 13. DAILY SNAPSHOT + DASHBOARD [V6.2]
// ============================================================
function logDailySnapshot() {
  const ss = getSS();
  let snapSheet = ss.getSheetByName("Daily Snapshots");
  if (!snapSheet) {
    snapSheet = ss.insertSheet("Daily Snapshots");
    snapSheet.appendRow(["Tanggal","Total Item","Stabil","Kritis","Waspada","Total Stok","Catatan"]);
  }
  const all = getAllStock("ALL");
  if (!all.success) return;
  let stabil=0, kritis=0, waspada=0, totalStok=0;
  all.items.forEach(i => {
    const akhir = Number(i.stockAkhir)||0;
    const aman = Number(i.stockAman)||0;
    totalStok += akhir;
    if (aman <= 0) { stabil++; return; }
    const pct = (akhir/aman)*100;
    if (pct <= 30) kritis++; else if (pct <= 60) waspada++; else stabil++;
  });
  snapSheet.appendRow([
    Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd"),
    all.count, stabil, kritis, waspada, totalStok, "Auto V6.3"
  ]);
  formatDailySnapshotsSheet_(snapSheet);
}

function updateLastUpdateTimestamp() {
  try {
    PropertiesService.getScriptProperties().setProperty("LAST_UPDATE",
      Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss"));
  } catch(e) {}
}

function getLastUpdateTimestamp() {
  return PropertiesService.getScriptProperties().getProperty("LAST_UPDATE") || "N/A";
}

function getDashboardData() {
  const all = getAllStock("ALL");
  if (!all.success) return { success: false, error: "Gagal membaca Stock CV/PT" };
  const status = { aman: 0, waspada: 0, kritis: 0 };
  const kritisItems = [];
  const divisions = {};
  let totalStock = 0, totalValueCV = 0, totalValuePT = 0;

  all.items.forEach(function(item) {
    const akhir = Number(item.stockAkhir) || 0;
    const aman = Number(item.stockAman) || 0;
    const pct = aman > 0 ? (akhir / aman) * 100 : (akhir <= 0 ? 0 : 100);
    const divisi = normalizeDivision_(item.divisi || "LAINNYA");
    if (!divisions[divisi]) divisions[divisi] = { divisi: divisi, total: 0, aman: 0, waspada: 0, kritis: 0 };
    divisions[divisi].total++;
    totalStock += akhir;
    if (item.entitas === "CV") totalValueCV += toNumber_(item.stockValue || item.nilaiStok || 0);
    else totalValuePT += toNumber_(item.stockValue || item.nilaiStok || 0);
    if (pct <= 30) {
      status.kritis++; divisions[divisi].kritis++;
      kritisItems.push({ kode: item.kode, nama: item.nama, divisi: divisi, sisa: akhir, aman: aman, kurang: aman - akhir, status: "KRITIS", entitas: item.entitas });
    } else if (pct <= 60) {
      status.waspada++; divisions[divisi].waspada++;
    } else {
      status.aman++; divisions[divisi].aman++;
    }
  });

  kritisItems.sort(function(a, b) { return b.kurang - a.kurang; });
  const activity = getTodayActivity_();
  const trend = getSevenDayTrend_();
  const divisionRows = Object.keys(divisions).map(function(k) { return divisions[k]; });
  divisionRows.sort(function(a, b) { return b.total - a.total; });
  const po = getPOStatus_();
  const total = all.count;
  return {
    success: true, generatedAt: new Date().toISOString(), lastUpdate: getLastUpdateTimestamp(), activeMonth: getActiveMonth(),
    totalItem: total, totalItemAktif: total, totalStok: totalStock,
    aman: status.aman, stabil: status.aman, waspada: status.waspada, kritis: status.kritis,
    status: { aman: status.aman, waspada: status.waspada, kritis: status.kritis,
      percentages: { aman: percent_(status.aman, total), waspada: percent_(status.waspada, total), kritis: percent_(status.kritis, total) } },
    statusPerDivisi: divisionRows, top10Kritis: kritisItems.slice(0, 10),
    aktivitasHariIni: activity, trend7Hari: trend, distribusiStatus: status,
    nilaiStok: { cv: totalValueCV, pt: totalValuePT, selisih: totalValueCV - totalValuePT },
    statusPO: po
  };
}

function getDashboard() { return getDashboardData(); }

function toNumber_(v) { const n = Number(String(v).replace(/[^0-9,.-]/g, "").replace(/,/g, ".")); return isNaN(n) ? 0 : n; }
function percent_(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
function normalizeDivision_(v) { return String(v || "LAINNYA").trim().toUpperCase().replace(/DAPUR1/g, "DAPUR 1").replace(/DAPUR2/g, "DAPUR 2") || "LAINNYA"; }

function getTodayActivity_() {
  const result = { masuk: 0, keluar: 0, rusak: 0, total: 0 };
  const today = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  Object.keys(SHEET_CONFIG).forEach(function(name) {
    const sh = getSS().getSheetByName(name), cfg = SHEET_CONFIG[name];
    if (!sh) return;
    const last = getRealLastDataRow(sh, cfg); if (last <= cfg.headerRow) return;
    const rows = sh.getRange(cfg.headerRow + 1, 2, last - cfg.headerRow, 5).getValues();
    rows.forEach(function(r) {
      const d = normalizeDateKey_(r[0]);
      if (d !== today) return;
      const qty = Math.abs(toNumber_(r[4]));
      if (name === "Barang masuk") result.masuk += qty;
      else if (name === "Barang keluar") result.keluar += qty;
      else result.rusak += qty;
    });
  });
  result.total = result.masuk + result.keluar + result.rusak;
  return result;
}

function normalizeDateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, TIMEZONE, "yyyy-MM-dd");
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? raw : Utilities.formatDate(parsed, TIMEZONE, "yyyy-MM-dd");
}

function getSevenDayTrend_() {
  const labels = [], values = [], now = new Date();
  const snap = getSS().getSheetByName("Daily Snapshots");
  const map = {};
  if (snap && snap.getLastRow() > 1) snap.getRange(2, 1, snap.getLastRow() - 1, 3).getValues().forEach(function(r) { map[normalizeDateKey_(r[0])] = toNumber_(r[1]); });
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const key = Utilities.formatDate(d, TIMEZONE, "yyyy-MM-dd");
    labels.push(Utilities.formatDate(d, TIMEZONE, "dd/MM")); values.push(map[key] || (i === 0 ? getAllStock("ALL").count : null));
  }
  return { labels: labels, values: values };
}

function getPOStatus_() {
  const result = { aktif: { cv: 0, pt: 0, purchaseOrder: 0, total: 0 }, konfirmasi: { cv: 0, pt: 0, purchaseOrder: 0, total: 0 } };
  const sh = getSS().getSheetByName("purchase order"); if (!sh) return result;
  const vals = sh.getDataRange().getDisplayValues();
  vals.forEach(function(r) { const s = r.join(" ").toUpperCase(); const n = r.reduce(function(a, v) { return a + (String(v).match(/^\\d+(?:[.,]\\d+)?$/) ? toNumber_(v) : 0); }, 0); if (s.indexOf("KONFIRM") >= 0) result.konfirmasi.total += n; else if (s.indexOf("PO CV") >= 0) result.aktif.cv += n; else if (s.indexOf("PO PT") >= 0) result.aktif.pt += n; else if (s.indexOf("PURCHASE ORDER") >= 0) result.aktif.purchaseOrder += n; });
  result.aktif.total = result.aktif.cv + result.aktif.pt + result.aktif.purchaseOrder;
  return result;
}


// ============================================================
// 14. DASHBOARD GOOGLE SHEETS â€” REAL-TIME RENDERER
// ============================================================
function diagnoseDashboard() {
  const ss = getSS();
  let sh = ss.getSheetByName("Dashboard");
  if (!sh) sh = ss.insertSheet("Dashboard", 0);
  try {
    sh.getRange("A1:B12").breakApart().clearContent();
    sh.getRange("A1").setValue("DIAGNOSTIK DASHBOARD â€” MULAI");
    SpreadsheetApp.flush();
    const data = getDashboardData();
    sh.getRange("A2:B8").setValues([
      ["getDashboardData", data.success ? "OK" : "GAGAL"],
      ["Total item", data.totalItemAktif || 0],
      ["Aman", data.aman || 0],
      ["Waspada", data.waspada || 0],
      ["Kritis", data.kritis || 0],
      ["Status per divisi", (data.statusPerDivisi || []).length],
      ["Tahap data", "BERHASIL"]
    ]);
    SpreadsheetApp.flush();
    const result = refreshDashboard();
    sh.getRange("A10:B12").setValues([["refreshDashboard", result.success ? "OK" : "GAGAL"], ["Pesan", result.message || result.error || "Selesai"], ["Waktu", new Date()]]);
    SpreadsheetApp.flush();
    return result;
  } catch (err) {
    sh.getRange("A10:B12").setValues([["refreshDashboard", "ERROR"], ["Pesan", String(err && err.message || err)], ["Stack", String(err && err.stack || "") .substring(0, 500)]]);
    SpreadsheetApp.flush();
    return { success: false, error: String(err && err.message || err) };
  }
}

function refreshAllData() {
  try { clearMasterCache(); } catch (e) {}
  const sync = syncDivisionStock();
  const dashboard = refreshDashboard();
  return { success: !!(sync && sync.success && dashboard && dashboard.success), sync: sync, dashboard: dashboard };
}

function clearDashboardCharts_(sheet) {
  try {
    const charts = sheet.getCharts();
    charts.forEach(function(chart) { sheet.removeChart(chart); });
  } catch (err) {
    console.error("Chart lama tidak dapat dihapus: " + err.message);
  }
}

function refreshDashboard() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) return { success: false, error: "Dashboard sedang diperbarui proses lain." };
  try {
    const ss = getSS();
    let sh = ss.getSheetByName("Dashboard");
    if (!sh) sh = ss.insertSheet("Dashboard", 0);
    const data = getDashboardData();
    if (!data.success) return data;
    if (sh.getMaxRows() < 55) sh.insertRowsAfter(sh.getMaxRows(), 55 - sh.getMaxRows());
    if (sh.getMaxColumns() < 14) sh.insertColumnsAfter(sh.getMaxColumns(), 14 - sh.getMaxColumns());
    // Reset aman: lepas merge lama terlebih dahulu agar refresh kedua dan seterusnya tidak gagal.
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.clear();
    clearDashboardCharts_(sh);
    sh.setFrozenRows(3);
    sh.getRange("A1:N1").merge().setValue("DASHBOARD GUDANG NASGOR 69").setFontSize(20).setFontWeight("bold").setFontColor("#111827");
    sh.getRange("A2:N2").merge().setValue("Pantauan Stok & Aktivitas â€” Real Time | Update: " + (data.lastUpdate || data.generatedAt)).setFontSize(10).setFontColor("#475569");
    sh.getRange("A4:N4").merge().setValue("RINGKASAN EKSEKUTIF").setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#0B5ED7");
    const cards = [["TOTAL ITEM AKTIF", data.totalItemAktif, "item"], ["KRITIS", data.kritis, percent_(data.kritis, data.totalItemAktif) + "%"], ["WASPADA", data.waspada, percent_(data.waspada, data.totalItemAktif) + "%"], ["AMAN", data.aman, percent_(data.aman, data.totalItemAktif) + "%"]];
    [["A6:C9", "#E8F1FF"], ["D6:F9", "#FDECEC"], ["G6:I9", "#FFF7D6"], ["J6:L9", "#EAF7EE"]].forEach(function(x, i) { const r = sh.getRange(x[0]); r.merge(); r.setValue(cards[i][0] + "\n\n" + cards[i][1] + " " + cards[i][2]).setBackground(x[1]).setFontSize(16).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle"); });
    sh.getRange("A11:F11").merge().setValue("1  STATUS PER DIVISI").setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#0B5ED7");
    sh.getRange("A12:F12").setValues([["DIVISI", "TOTAL ITEM", "AMAN", "WASPADA", "KRITIS", "% KRITIS"]]).setFontWeight("bold").setBackground("#DBEAFE").setHorizontalAlignment("center");
    const divRows = data.statusPerDivisi.map(function(d) { return [d.divisi, d.total, d.aman, d.waspada, d.kritis, percent_(d.kritis, d.total) / 100]; });
    if (divRows.length) sh.getRange(13, 1, divRows.length, 6).setValues(divRows).setHorizontalAlignment("center");
    sh.getRange(13, 6, Math.max(1, divRows.length), 1).setNumberFormat("0.0%");
    sh.getRange("H11:N11").merge().setValue("2  TOP 10 ITEM KRITIS").setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#0B5ED7");
    sh.getRange("H12:N12").setValues([["NO", "KODE", "NAMA BARANG", "DIVISI", "SISA", "BATAS AMAN", "STATUS"]]).setFontWeight("bold").setBackground("#DBEAFE").setHorizontalAlignment("center");
    const criticalRows = data.top10Kritis.map(function(x, i) { return [i + 1, x.kode, x.nama, x.divisi, x.sisa, x.aman, x.status]; });
    if (criticalRows.length) sh.getRange(13, 8, criticalRows.length, 7).setValues(criticalRows).setHorizontalAlignment("center").setWrap(true);
    const base = 25;
    sh.getRange("A" + base + ":D" + base).merge().setValue("3  AKTIVITAS HARI INI").setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#0B5ED7");
    sh.getRange(base + 1, 1, 4, 2).setValues([["BARANG MASUK", data.aktivitasHariIni.masuk], ["BARANG KELUAR", data.aktivitasHariIni.keluar], ["BARANG RUSAK", data.aktivitasHariIni.rusak], ["TOTAL TRANSAKSI", data.aktivitasHariIni.total]]).setHorizontalAlignment("center");
    sh.getRange("F" + base + ":I" + base).merge().setValue("4  DISTRIBUSI STATUS").setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#0B5ED7");
    sh.getRange(base + 1, 6, 3, 2).setValues([["AMAN", data.aman], ["WASPADA", data.waspada], ["KRITIS", data.kritis]]).setHorizontalAlignment("center");
    sh.getRange("K" + base + ":N" + base).merge().setValue("5  STATUS PO").setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#0B5ED7");
    sh.getRange(base + 1, 11, 3, 4).setValues([["PO AKTIF", data.statusPO.aktif.total, "PO KONFIRMASI", data.statusPO.konfirmasi.total], ["PO CV", data.statusPO.aktif.cv, "PO CV", data.statusPO.konfirmasi.cv], ["PO PT", data.statusPO.aktif.pt, "PO PT", data.statusPO.konfirmasi.pt]]).setHorizontalAlignment("center");
    sh.getRange("A32:N32").merge().setValue("GRAFIK ANALITIK â€” AREA TERPISAH DARI RINGKASAN DAN STATUS PO").setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#0B5ED7");
    sh.getRange("A49:N49").merge().setValue("Dashboard ini diperbarui otomatis saat data transaksi/master berubah dan melalui trigger berkala.").setFontStyle("italic").setFontColor("#475569");
    [130, 110, 110, 110, 110, 90, 30, 70, 110, 260, 90, 100, 110, 120].forEach(function(w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange("A1:N49").setVerticalAlignment("middle");
    // Grafik bersifat tambahan. Jika akun/Spreadsheet menolak pembuatan chart,
    // tabel dan kartu tetap disimpan sehingga dashboard tidak menjadi kosong.
    try {
      // Semua grafik ditempatkan di area analitik khusus mulai baris 33.
      // Dengan ukuran eksplisit, grafik tidak menimpa kartu, tabel, atau blok nomor 5.
      const chartWidth = 520;
      const chartHeight = 320;
      const titleStyle = { fontSize: 16, bold: true, color: "#111827" };
      const bar = sh.newChart().asBarChart().addRange(sh.getRange(12, 1, Math.max(2, divRows.length + 1), 5)).setPosition(33, 2, 0, 0).setOption("title", "Status per Divisi").setOption("titleTextStyle", titleStyle).setOption("width", chartWidth).setOption("height", chartHeight).build();
      sh.insertChart(bar);
      const chart = sh.newChart().asPieChart().addRange(sh.getRange(base + 1, 6, 3, 2)).setPosition(33, 9, 0, 0).setOption("title", "Distribusi Status").setOption("titleTextStyle", titleStyle).setOption("pieHole", 0.45).setOption("width", chartWidth).setOption("height", chartHeight).build();
      sh.insertChart(chart);
    } catch (chartErr) {
      console.error("Chart Dashboard dilewati: " + chartErr.message);
    }
    updateLastUpdateTimestamp();
    return { success: true, sheet: "Dashboard", updatedAt: getLastUpdateTimestamp(), summary: { total: data.totalItemAktif, aman: data.aman, waspada: data.waspada, kritis: data.kritis } };
  } finally { if (lock.hasLock()) lock.releaseLock(); }
}


// ============================================================
// 15. PO RECOMMENDATIONS [V6.2 formal format]
// ============================================================
function generatePORecommendations() {
  const all = getAllStock("ALL");
  if (!all.success) return [];
  // PO otomatis hanya untuk master divisi CS revisi. Divisi lain tidak boleh masuk.
  const csItems = all.items.filter(i => String(i.divisi || "").trim().toUpperCase() === "CS");
  if (csItems.length !== 43) {
    throw new Error("MASTER CS TIDAK VALID: diharapkan 43 item, terbaca " + csItems.length + ". PO dibatalkan untuk mencegah item non-CS atau master tidak lengkap.");
  }
  return csItems.filter(i => {
    const akhir = Number(i.stockAkhir)||0;
    const aman = Number(i.stockAman)||0;
    return aman > 0 && akhir < aman;
  }).map(i => {
    const akhir = Number(i.stockAkhir)||0;
    const aman = Number(i.stockAman)||0;
    const kurang = aman - akhir;
    const kodeUpper = String(i.kode || "").trim().toUpperCase();
    const isCV = kodeUpper.indexOf("CV-") === 0 || kodeUpper.indexOf("BBCV-") === 0;
    const isPT = kodeUpper.indexOf("PT-") === 0 || kodeUpper.indexOf("WK-") === 0 || kodeUpper.indexOf("BBPT-") === 0;
    if (!isCV && !isPT) throw new Error("PREFIX ENTITAS PO TIDAK DIKENAL: " + i.kode + ". PO dibatalkan untuk mencegah salah kolom CV/PT.");
    return { kode:i.kode, nama:i.nama, satuan:i.satuan, sisa:akhir, aman:aman, kurang:kurang,
             poCV: isCV ? kurang : 0, poPT: isPT ? kurang : 0 };
  }).sort((a,b) => b.kurang - a.kurang);
}

function writePORecommendations() {
  const ss = getSS();
  const sheet = ss.getSheetByName("purchase order");
  if (!sheet) return { success: false, error: "Sheet 'purchase order' tidak ditemukan" };

  const recommendations = generatePORecommendations();
  const existingEnd = findPODataEndRow(sheet, 6);
  const neededEnd = Math.max(existingEnd, 5 + recommendations.length);
  const protection = inspectPORangeProtection_(sheet, 4, 2, Math.max(2, neededEnd - 3), 8);
  if (!protection.safe) return { success: false, error: "PO DIBATALKAN: range tabel Purchase Order terlindungi", reviewRequired: true, protection: protection };
  if (!recommendations || recommendations.length === 0) {
    clearPOTableData(sheet);
    updatePODateRow4(sheet);
    return { success: true, message: "Tidak ada item perlu di-PO", count: 0 };
  }

  const sizeMap = getSizeMapFromDivisiCS();
  updatePODateRow4(sheet);

  const DATA_START = 6, HEADER_ROW = 5;
  const endRow = findPODataEndRow(sheet, DATA_START);
  const available = Math.max(0, endRow - DATA_START + 1);
  if (recommendations.length > available) {
    try { sheet.insertRowsAfter(endRow, recommendations.length - available); } catch(e) {}
  }
  clearPOTableData(sheet);

  const rows = recommendations.map((r, i) => {
    const size = sizeMap[r.kode] || sizeMap[r.nama] || "";
    const total = (Number(r.poCV)||0) + (Number(r.poPT)||0);
    return [i+1, r.nama||"", size, r.satuan||"", Number(r.poCV)||0, Number(r.poPT)||0, total, ""];
  });
  sheet.getRange(DATA_START, 2, rows.length, 8).setValues(rows);
  ensurePOHeader(sheet, HEADER_ROW);
  const formatting = formatPOTable_(sheet, DATA_START, rows.length, HEADER_ROW);
  updateLastUpdateTimestamp();

  return { success: true, message: "PO divisi CS ditulis ke format tabel (baris 6+).", count: recommendations.length,
           division: "CS", eligibleMasterCount: 43, formatting: formatting,
           generatedAt: Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm") };
}

function updatePODateRow4(sheet) {
  const todayStr = Utilities.formatDate(new Date(), TIMEZONE, "d MMMM yyyy").toUpperCase();
  const row4 = sheet.getRange(4,1,1,10).getValues()[0];
  for (let c=0; c<row4.length; c++) {
    if (String(row4[c]).toUpperCase().indexOf("TANGGAL")>=0) {
      sheet.getRange(4, c+1).setValue("TANGGAL : " + todayStr); return;
    }
  }
  sheet.getRange(4,2).setValue("TANGGAL : " + todayStr);
}

function clearPOTableData(sheet) {
  const DATA_START = 6;
  const endRow = findPODataEndRow(sheet, DATA_START);
  if (endRow >= DATA_START) sheet.getRange(DATA_START,2,endRow-DATA_START+1,8).clearContent();
}

function findPODataEndRow(sheet, startRow) {
  const last = Math.min(sheet.getLastRow(), startRow+100);
  for (let r=startRow; r<=last; r++) {
    const v = (String(sheet.getRange(r,2).getValue()) + " " + String(sheet.getRange(r,3).getValue())).toLowerCase();
    if (v.indexOf("dibuat oleh")>=0 || v.indexOf("mengetahui")>=0) return r-1;
  }
  for (let r=startRow; r<=last; r++) if (!sheet.getRange(r,3).getValue()) return r-1;
  return last;
}

function ensurePOHeader(sheet, headerRow) {
  const expected = ["NO","NAMA BARANG","SIZE","SATUAN","PO CV","PO PT","TOTAL","TGL KEDATANGAN"];
  const header = sheet.getRange(headerRow, 2, 1, 8);
  const cur = header.getValues()[0];
  if (expected.some((h,i)=>String(cur[i]||"").toUpperCase()!==h)) header.setValues([expected]);
  header.setFontWeight("bold").setBackground("#1F4E79").setFontColor("#FFFFFF")
        .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true)
        .setBorder(true, true, true, true, true, true, "#8EA9C1", SpreadsheetApp.BorderStyle.SOLID);
}

function inspectPORangeProtection_(sheet, row, column, numRows, numColumns) {
  const result = { safe: true, protected: false, ranges: [] };
  try {
    const target = sheet.getRange(row, column, numRows, numColumns);
    const protections = [];
    try { protections.push.apply(protections, sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE) || []); } catch (e) {}
    try { protections.push.apply(protections, sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET) || []); } catch (e) {}
    protections.forEach(function(p) {
      try {
        const pr = p.getRange ? p.getRange() : null;
        if (!pr || rangesIntersect_(target, pr)) { result.safe = false; result.protected = true; result.ranges.push(pr ? pr.getA1Notation() : "SHEET"); }
      } catch (e) { result.safe = false; result.protected = true; result.ranges.push("UNKNOWN_PROTECTION"); }
    });
  } catch (e) { result.safe = false; result.protected = true; result.error = e.message; }
  return result;
}

function rangesIntersect_(a, b) {
  const aR = a.getRow(), aC = a.getColumn(), aR2 = aR + a.getNumRows() - 1, aC2 = aC + a.getNumColumns() - 1;
  const bR = b.getRow(), bC = b.getColumn(), bR2 = bR + b.getNumRows() - 1, bC2 = bC + b.getNumColumns() - 1;
  return aR <= bR2 && aR2 >= bR && aC <= bC2 && aC2 >= bC;
}

function analyzePORecommendations_() {
  try {
    const all = getAllStock("ALL");
    if (!all.success) return { success: false, readOnly: true, error: "Master stok tidak terbaca" };
    const csItems = all.items.filter(i => String(i.divisi || "").trim().toUpperCase() === "CS");
    if (csItems.length !== 43) return { success: false, readOnly: true, reviewRequired: true, error: "MASTER CS TIDAK VALID: diharapkan 43 item, terbaca " + csItems.length, division: "CS", eligibleMasterCount: csItems.length };
    const recommendations = generatePORecommendations();
    return { success: true, readOnly: true, division: "CS", eligibleMasterCount: 43, recommendationCount: recommendations.length, recommendations: recommendations };
  } catch (e) { return { success: false, readOnly: true, reviewRequired: true, error: e.message }; }
}

function formatPOTable_(sheet, dataStart, rowCount, headerRow) {
  const width = 8;
  const protection = inspectPORangeProtection_(sheet, headerRow, 2, rowCount + 1, width);
  if (!protection.safe) return protection;
  sheet.getRange(4, 2, 1, width).setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  if (!rowCount) return { safe: true, protected: false, formattedRows: 0, range: sheet.getRange(headerRow, 2, 1, width).getA1Notation() };
  const dataRange = sheet.getRange(dataStart, 2, rowCount, width);
  dataRange.setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true)
           .setFontColor("#17324D")
           .setBorder(true, true, true, true, true, true, "#B7C9D6", SpreadsheetApp.BorderStyle.SOLID);
  for (let i = 0; i < rowCount; i++) {
    sheet.getRange(dataStart + i, 2, 1, width)
         .setBackground(i % 2 === 0 ? "#EAF2F8" : "#FFFFFF");
  }
  sheet.setRowHeight(headerRow, 30);
  for (let r = dataStart; r < dataStart + rowCount; r++) sheet.setRowHeight(r, 24);
  return { safe: true, protected: false, formattedRows: rowCount, range: sheet.getRange(headerRow, 2, rowCount + 1, width).getA1Notation() };
}

function getSizeMapFromDivisiCS() {
  const map = Object.assign({}, SIZE_MAP_CS);
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName("Data Stok Per Divisi");
    if (!sheet) return map;
    const data = sheet.getDataRange().getValues();
    let inCS = false, colKode=-1, colNama=-1, colSize=-1;
    for (let i=0; i<data.length; i++) {
      const first = String(data[i][0]||"").toUpperCase();
      if (first.indexOf("DIVISI : CS")>=0 || first.indexOf("DIVISI: CS")>=0) { inCS=true; continue; }
      if (inCS && (first.indexOf("DIVISI :")>=0 || first.indexOf("TOTAL ITEM")>=0)) { inCS=false; continue; }
      if (!inCS) continue;
      const rs = data[i].map(c=>String(c).toLowerCase());
      if (rs.includes("kode barang") || rs[0]==="no") {
        colKode=rs.findIndex(c=>c.includes("kode")); colNama=rs.findIndex(c=>c.includes("nama")); colSize=rs.findIndex(c=>c.includes("size")); continue;
      }
      if (colKode>=0 && colSize>=0) {
        const k=String(data[i][colKode]||"").trim(), n=colNama>=0?String(data[i][colNama]||"").trim():"", s=String(data[i][colSize]||"").trim();
        if (k && s) { map[k]=s; if(n) map[n]=s; }
      }
    }
  } catch(e) {}
  return map;
}


// ============================================================
// 15. LAPORAN EMAIL HARIAN [V6.2]
// ============================================================
function sendDailyStockReport() {
  const ss = getSS();
  const todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  const subject = "[GudangAI] Laporan Stok Harian - " + todayStr;

  let kritis = [], waspada = [], stabil = 0;
  ["Stock CV","Stock PT"].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const last = sheet.getLastRow();
    if (last < 4) return;
    const hdr = sheet.getRange(3,1,1,sheet.getLastColumn()).getValues()[0].map(h=>String(h).toLowerCase().trim());
    const cK = hdr.findIndex(h=>h.includes("kode"))+1;
    const cN = hdr.findIndex(h=>h.includes("nama"))+1;
    const cS = hdr.findIndex(h=>h.includes("satuan"))+1;
    const cA = hdr.findIndex(h=>h.includes("stock akhir"))+1;
    const cM = hdr.findIndex(h=>h.includes("stock aman"))+1;
    if (cK===0||cA===0) return;
    const label = name==="Stock CV" ? "CV" : "PT";
    sheet.getRange(4,1,last-3,sheet.getLastColumn()).getValues().forEach(row=>{
      const kode = String(row[cK-1]||"").trim();
      if (!kode || kode.indexOf("Total")===0) return;
      const akhir = clampStockToZero_(row[cA-1]);
      const aman = cM>0 ? Number(row[cM-1])||0 : 0;
      if (aman<=0 && akhir===0) kritis.push({kode,nama:row[cN-1],satuan:row[cS-1],entitas:label,akhir,aman});
      else if (aman>0) {
        const pct = (akhir/aman)*100;
        if (pct<=30) kritis.push({kode,nama:row[cN-1],satuan:row[cS-1],entitas:label,akhir,aman});
        else if (pct<=60) waspada.push({kode,nama:row[cN-1],satuan:row[cS-1],entitas:label,akhir,aman});
        else stabil++;
      } else stabil++;
    });
  });

  let html = "<h2>Laporan Stok Harian GudangAI V6.3 - " + todayStr + "</h2>";
  html += "<p><strong>Stabil:</strong> " + stabil + " | <strong>Kritis:</strong> " + kritis.length + " | <strong>Waspada:</strong> " + waspada.length + "</p>";
  html += "<h3 style='color:red'>KRITIS (" + kritis.length + ")</h3>";
  if (kritis.length) {
    html += "<table border=1 cellpadding=4><tr><th>Entitas</th><th>Kode</th><th>Nama</th><th>Sisa</th><th>Aman</th></tr>";
    kritis.forEach(i => html += "<tr><td>"+i.entitas+"</td><td>"+i.kode+"</td><td>"+i.nama+"</td><td>"+i.akhir+"</td><td>"+i.aman+"</td></tr>");
    html += "</table>";
  }
  if (waspada.length) {
    html += "<h3 style='color:orange'>WASPADA (" + waspada.length + ")</h3>";
    html += "<table border=1 cellpadding=4><tr><th>Entitas</th><th>Kode</th><th>Nama</th><th>Sisa</th><th>Aman</th></tr>";
    waspada.forEach(i => html += "<tr><td>"+i.entitas+"</td><td>"+i.kode+"</td><td>"+i.nama+"</td><td>"+i.akhir+"</td><td>"+i.aman+"</td></tr>");
    html += "</table>";
  }
  html += "<p><em>GudangAI V6.3 â€” " + getSS().getName() + "</em></p>";
  try { MailApp.sendEmail({ to: ADMIN_EMAIL, subject: subject, htmlBody: html }); } catch(e) {}
  return { success: true, kritis: kritis.length, waspada: waspada.length, stabil };
}


// ============================================================
// 16. WEEKLY PO AUTOMATION
// ============================================================
function weeklyPOAutomation() {
  const result = writePORecommendations();
  if (result.success && result.count > 0) {
    try {
      MailApp.sendEmail(ADMIN_EMAIL,
        "[GudangAI] Rekomendasi PO Mingguan â€” " + result.count + " item",
        "Sheet 'purchase order' sudah diperbarui.\nTotal item: " + result.count +
        "\nWaktu: " + (result.generatedAt || new Date()) +
        "\n\nSilakan cek sheet 'purchase order'.\nTautan: https://docs.google.com/spreadsheets/d/" + getSpreadsheetId()
      );
    } catch(e) {}
  }
  return result;
}


function emailQueueWriteApproved_(payload) {
  return payload && payload.queueApproved === true && !!(payload.transactionId || payload.nonce || payload.batchId);
}

function emailQueueClaimKey_(payload) {
  const identity = payload.transactionId || payload.nonce || payload.batchId || JSON.stringify({
    action: payload.action, sheet: payload.sheet, kodeBarang: payload.kodeBarang,
    qty: payload.qty, tanggal: payload.tanggal, keterangan: payload.keterangan,
    transactions: payload.transactions
  });
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(identity));
  return "emailQueueClaim_" + Utilities.base64EncodeWebSafe(digest).substring(0, 180);
}

function claimEmailQueuePayload_(payload) {
  const key = emailQueueClaimKey_(payload);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { claimed: false, key: key, error: "Tidak dapat mengunci claim queue." };
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(key)) return { claimed: false, key: key, duplicate: true };
    props.setProperty(key, JSON.stringify({ claimedAt: new Date().toISOString(), action: payload.action || "" }));
    return { claimed: true, key: key };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

// ============================================================
// 17. EMAIL QUEUE â€” AKSES CLAUDE [V6.0]
// ============================================================
function processEmailQueue() {
  try {
    const drafts = GmailApp.getDrafts();
    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i];
      let msg;
      try { msg = draft.getMessage(); } catch (e) { continue; }

      const subject = msg.getSubject() || "";
      if (subject.indexOf(QUEUE_SUBJECT_TAG) !== 0) continue;

      const bodyText = msg.getPlainBody() || "";
      let payload;
      try {
        const jsonMatch = bodyText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Tidak ditemukan JSON valid di body draft.");
        payload = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        writeAuditLogSecure("EMAIL_QUEUE", "PARSE_FAILED", { subject: subject, bodyPreview: bodyText.substring(0, 300) }, parseErr.message, null);
        try { draft.deleteDraft(); } catch (e2) {}
        continue;
      }

      let result;
      // Gmail queue sepenuhnya non-eksekusi. Draft lama maupun approved hanya
      // dicatat sebagai blocked lalu dihapus; tidak boleh ada side effect ke spreadsheet.
      result = { success: false, reviewRequired: true, writeBlocked: true, error: "EMAIL_QUEUE_DISABLED: queue Gmail tidak memiliki hak eksekusi; gunakan Web App/API terautentikasi." };

      writeAuditLogSecure("EMAIL_QUEUE", result.success ? "SUCCESS" : "FAILED",
        { payload: payload, result: result }, result.error || "", result.transactionId || null);
      try { draft.deleteDraft(); } catch (e3) {}
    }
  } catch (err) {
    sendErrorEmailWithCooldown("processEmailQueue", err, {});
  }
}

function installQueueTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "processEmailQueue") {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log("Queue write DINONAKTIFKAN; trigger lama dihapus: " + removed);
  return { success: true, disabled: true, removed: removed };
}


// ============================================================
// 18. onEdit TRIGGER [V6.0 + V6.2]
// ============================================================
function onEdit(e) {
  try {
    if (!e || !e.source || !e.range) return;
    const sheetName = e.range.getSheet().getName();
    if (sheetName === "Stock CV" || sheetName === "Stock PT" || sheetName === "Stock awal") {
      clearMasterCache();
      // Semua sumber stok memicu rebuild Data Stok Per Divisi.
      // Stock CV/PT diperlukan karena kolom Sisa Stok dibaca dari kedua sheet tersebut.
      try { syncDivisionStock(); } catch(syncErr) { console.error("Auto-sync divisi gagal: " + syncErr.message); }
      try { refreshDashboard(); } catch(dashErr) { console.error("Refresh dashboard gagal: " + dashErr.message); }
    }
    if (Object.keys(SHEET_CONFIG).indexOf(sheetName) >= 0) {
      try { refreshDashboard(); } catch(dashErr2) { console.error("Refresh dashboard transaksi gagal: " + dashErr2.message); }
    }
  } catch (e) {}
}


// ============================================================
// 19. SETUP ENVIRONMENT [V6.3 UNIFIED]
// ============================================================
function setupEnvironment() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Jalankan dari dalam spreadsheet.");

  const props = PropertiesService.getScriptProperties();
  props.setProperty("SPREADSHEET_ID", ss.getId());
  console.log("SPREADSHEET_ID = " + ss.getId() + " (" + ss.getName() + ")");
  try { setupConfigSheet(); } catch (configErr) { console.error("Config sheet gagal dibuat: " + configErr.message); }
  try { getIdempotencyLedgerSheet_(); } catch (ledgerErr) { console.error("Idempotency Ledger gagal dibuat: " + ledgerErr.message); }

  if (!props.getProperty("API_SECRET")) {
    const secret = Utilities.getUuid().replace(/-/g,"") + Utilities.getUuid().replace(/-/g,"").substring(0,16);
    props.setProperty("API_SECRET", secret);
    console.log("API_SECRET baru dibuat dan disimpan; nilai secret tidak dicetak ke log.");
  } else {
    console.log("API_SECRET sudah ada.");
  }

  // Hapus trigger lama
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (["sendDailyStockReport","weeklyPOAutomation","logDailySnapshot","processEmailQueue","sendWeeklyPOReport","refreshDashboard","refreshAllData","onEdit"].indexOf(fn) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Setup trigger baru
  ScriptApp.newTrigger("sendDailyStockReport").timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger("weeklyPOAutomation").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  ScriptApp.newTrigger("logDailySnapshot").timeBased().everyDays(1).atHour(23).create();
  // processEmailQueue sengaja tidak dijadwalkan; seluruh queue write fail-closed.
  ScriptApp.newTrigger("refreshAllData").timeBased().everyMinutes(5).create();
  // Installable onEdit trigger agar perubahan manual pada semua sumber stok
  // dapat menjalankan sinkronisasi yang membutuhkan otorisasi SpreadsheetApp.
  ScriptApp.newTrigger("onEdit").forSpreadsheet(ss).onEdit().create();

  _cachedSS = null;
  _resolvedSpreadsheetId = null;
  updateLastUpdateTimestamp();
  try { formatOperationalSheets_(); } catch (formatErr) { console.error("Format Daily Snapshots/System Log gagal: " + formatErr.message); }
  try { refreshDashboard(); } catch (dashboardErr) { console.error("Initial dashboard refresh gagal: " + dashboardErr.message); }

  const activeMonth = getActiveMonth();
  console.log("=== setupEnvironment BACKEND GudangAI-69 " + BACKEND_VERSION + " SELESAI ===");
  console.log("Spreadsheet: " + ss.getName());
  console.log("Bulan aktif: " + activeMonth.nama + " " + activeMonth.tahun);
  console.log("Trigger: sendDailyStockReport(07:00), weeklyPOAutomation(Senin 08:00), logDailySnapshot(23:00), queue write disabled, refreshAllData(5min)");
  console.log("Total master data: 189 item (CV 81 + PT 108)");

  return { success: true, spreadsheetId: ss.getId(), spreadsheetName: ss.getName(), activeMonth: activeMonth,
           title: APP_TITLE, configSheet: CONFIG_SHEET_NAME,
           message: "Backend V6.4 siap. Config, trigger, Dashboard, Data Stok Per Divisi, Daily Snapshots, dan System Log siap digunakan." };
}

function generateRandomSecret() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").substring(0, 16);
}

function resetApiSecret() {
  const newSecret = generateRandomSecret();
  PropertiesService.getScriptProperties().setProperty("API_SECRET", newSecret);
  Logger.log("API_SECRET direset; nilai secret tidak dicetak ke log.");
  return newSecret;
}


// ============================================================
// 20. TEST FUNCTIONS [V6.0]
// ============================================================
function testAddTransaction(executeApproved) {
  const request = { sheet: "Barang masuk", entitas: "CV", kodeBarang: "CV-0001", qty: 1,
    tanggal: Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT), keterangan: "TEST DRY-RUN V6.4.4+OUTBOX" };
  if (executeApproved === true) {
    request.transactionId = "TEST-" + Utilities.getUuid();
    request.nonce = request.transactionId;
    request.queueApproved = true;
    request._syncMode = true;
    return syncTransaction(request);
  }
  const result = validateTransactionRequest_(request, { requireDate: true, requireEntity: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function testConnection() {
  const ss = getSS();
  const month = getActiveMonth();
  Logger.log("Koneksi OK: " + ss.getName() + " | Bulan: " + month.nama + " " + month.tahun);
  return { success: true, name: ss.getName(), month: month, version: BACKEND_VERSION };
}


// ============================================================
// END OF FILE â€” BACKEND GudangAI-69 V6.4 â€” UNIFIED
// ============================================================

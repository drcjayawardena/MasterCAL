/**
 * ============================================================
 *  VEHICLE MATCH — Matching.gs  (Matching engine)
 * ============================================================
 *  Auto-matches as soon as a buyer or vehicle is saved.
 *  Re-match everything: refreshAllMatches()
 *  Hourly auto re-match: run installHourlyTrigger() once.
 * ============================================================
 */

const MATCH_CONFIG = {
  VERSION: '3.6',        // must match APP.VERSION in Code.gs
  MIN_SCORE: 50,           // New matches below this score are not saved
  BUDGET_TOLERANCE: 0.10,  // Allow prices up to 10% over budget (room to negotiate)
  YEAR_TOLERANCE: 1,       // Half points if within 1 year outside the range
  WEIGHTS: {               // Total 100
    MAKE_MODEL: 30,
    YEAR: 20,
    PRICE: 20,
    FUEL: 10,
    TRANSMISSION: 10,
    DISTRICT: 10
  },
  // Must match the names in DROPDOWN_LISTS → MATCH_STATUS
  STATUS: { NEW: 'New', DEAL: 'Deal ✅', REJECTED: 'Rejected ❌' },
  BUYER_ACTIVE: 'Active', BUYER_DONE: 'Bought',
  VEHICLE_ACTIVE: 'Available', VEHICLE_DONE: 'Sold'
};

// ============================================================
//  SCORING
// ============================================================
/**
 * Score between Buyer (b) and Vehicle (v), 0–100.
 * 0 = excluded by a hard filter.
 * An empty buyer field means "any is fine".
 */
function scoreMatch_(b, v) {
  const W = MATCH_CONFIG.WEIGHTS;
  const reasons = [];

  // ---- Hard filters ----
  if (b.vehicle_type && v.vehicle_type && n_(b.vehicle_type) !== n_(v.vehicle_type)) {
    return { score: 0, reasons: ['Different type'] };
  }
  if (b.make && v.make && n_(b.make) !== n_(v.make)) {
    return { score: 0, reasons: ['Different make'] };
  }
  const maxBudget = num_(b.max_budget);
  const price = num_(v.price);
  if (maxBudget && price && price > maxBudget * (1 + MATCH_CONFIG.BUDGET_TOLERANCE)) {
    return { score: 0, reasons: ['Far over budget'] };
  }

  let s = 0;

  // ---- Make + Model ----
  if (!b.model || n_(b.model) === n_(v.model)) {
    s += W.MAKE_MODEL;
    if (b.model) reasons.push('Model ✓');
  } else {
    s += W.MAKE_MODEL * 0.3;
    reasons.push('Different model');
  }

  // ---- Year ----
  const y = num_(v.year), yf = num_(b.year_from), yt = num_(b.year_to);
  if (!yf && !yt) {
    s += W.YEAR;
  } else if (y) {
    const lo = yf || 0, hi = yt || 9999;
    if (y >= lo && y <= hi) { s += W.YEAR; reasons.push('Year ✓'); }
    else if (y >= lo - MATCH_CONFIG.YEAR_TOLERANCE && y <= hi + MATCH_CONFIG.YEAR_TOLERANCE) {
      s += W.YEAR * 0.5; reasons.push('Year close');
    }
  }

  // ---- Price ----
  if (!maxBudget || !price) {
    s += W.PRICE * 0.5;
  } else if (price <= maxBudget) {
    s += W.PRICE; reasons.push('Budget ✓');
  } else {
    s += W.PRICE * 0.4; reasons.push('Slightly over budget');
  }

  // ---- Fuel / Transmission / District ----
  if (!b.fuel || n_(b.fuel) === n_(v.fuel)) { s += W.FUEL; if (b.fuel) reasons.push('Fuel ✓'); }
  if (!b.transmission || n_(b.transmission) === n_(v.transmission)) { s += W.TRANSMISSION; if (b.transmission) reasons.push('Gear ✓'); }
  if (!b.district || n_(b.district) === n_(v.district)) { s += W.DISTRICT; if (b.district) reasons.push('District ✓'); }

  return { score: Math.round(s), reasons: reasons };
}

// ============================================================
//  RUNNERS
// ============================================================
/** Re-match all active buyers × available vehicles. */
function refreshAllMatches() {
  return upsertMatches_(
    readAll_('BUYERS').filter(isBuyerActive_),
    readAll_('VEHICLES').filter(isVehicleAvailable_)
  );
}

function matchForBuyer_(buyerId) {
  const b = findById_('BUYERS', 'buyer_id', buyerId);
  if (!b || !isBuyerActive_(b)) return { added: 0, updated: 0 };
  return upsertMatches_([b], readAll_('VEHICLES').filter(isVehicleAvailable_));
}

function matchForVehicle_(vehicleId) {
  const v = findById_('VEHICLES', 'vehicle_id', vehicleId);
  if (!v || !isVehicleAvailable_(v)) return { added: 0, updated: 0 };
  return upsertMatches_(readAll_('BUYERS').filter(isBuyerActive_), [v]);
}

/** Adds new matches; for existing ones only the score is updated (status/notes are kept). */
function upsertMatches_(buyers, vehicles) {
  const res = upsertMatchRows_(buyers, vehicles);
  // Email both officers about the new matches (outside the lock; never breaks saving)
  if (res.newRows.length && typeof notifyNewMatches_ === 'function') {
    notifyNewMatches_(res.newRows, mapBy_(buyers, 'buyer_id'), mapBy_(vehicles, 'vehicle_id'));
  }
  return { added: res.added, updated: res.updated };
}

function upsertMatchRows_(buyers, vehicles) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_('MATCHES');
    const cols = SCHEMA.MATCHES;
    const iB = cols.indexOf('buyer_id'), iV = cols.indexOf('vehicle_id');
    const iS = cols.indexOf('score'), iU = cols.indexOf('updated_at');
    const last = sh.getLastRow();
    const data = last > 1 ? sh.getRange(2, 1, last - 1, cols.length).getValues() : [];

    const existing = {};
    data.forEach(function (r, i) { existing[r[iB] + '|' + r[iV]] = i; });

    const now = new Date();
    const newRows = [];
    let updated = 0;

    buyers.forEach(function (b) {
      vehicles.forEach(function (v) {
        const score = scoreMatch_(b, v).score;
        const key = b.buyer_id + '|' + v.vehicle_id;
        if (existing[key] !== undefined) {
          const r = data[existing[key]];
          if (Number(r[iS]) !== score) { r[iS] = score; r[iU] = now; updated++; }
        } else if (score >= MATCH_CONFIG.MIN_SCORE) {
          newRows.push({
            match_id: 'M' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(),
            buyer_id: b.buyer_id, vehicle_id: v.vehicle_id, score: score,
            status: MATCH_CONFIG.STATUS.NEW, notes: '', follow_up: '',
            created_at: now, updated_at: now, updated_by: 'system'
          });
        }
      });
    });

    if (updated) sh.getRange(2, 1, data.length, cols.length).setValues(data);
    appendRows_('MATCHES', newRows);
    SpreadsheetApp.flush();
    return { added: newRows.length, updated: updated, newRows: newRows };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
//  READ / UPDATE (API handlers)
// ============================================================
/**
 * p: { buyerId, vehicleId, minScore, includeClosed }
 * By default, hides Rejected matches and matches for Sold/Bought records (except Deals).
 */
function getMatches_(p, user) {
  p = p || {};
  const bMap = mapBy_(readAll_('BUYERS'), 'buyer_id');
  const vMap = mapBy_(readAll_('VEHICLES'), 'vehicle_id');
  const officers = officersMap_();
  const minScore = (p.minScore === undefined || p.minScore === '') ? MATCH_CONFIG.MIN_SCORE : Number(p.minScore);
  const S = MATCH_CONFIG.STATUS;

  const out = readAll_('MATCHES').filter(function (m) {
    if (!canSeeMatch_(m, bMap, vMap, user)) return false;
    if (p.buyerId && String(m.buyer_id) !== String(p.buyerId)) return false;
    if (p.vehicleId && String(m.vehicle_id) !== String(p.vehicleId)) return false;
    if (Number(m.score) < minScore) return false;
    if (!p.includeClosed) {
      // Closed deals live on the Deals page; rejected ones are hidden too.
      if (isRejectedMatch_(m.status) || isDeal_(m.status)) return false;
      const b = bMap[String(m.buyer_id)], v = vMap[String(m.vehicle_id)];
      if (!b || !v || !isBuyerActive_(b) || !isVehicleAvailable_(v)) return false;
    }
    return true;
  }).map(function (m) { return enrichMatch_(m, bMap, vMap, user, officers); })
    .sort(function (a, b) { return b.score - a.score; });

  return { matches: out };
}

function updateMatch_(p, user) {
  const lists = getLists_();
  if ((lists.MATCH_STATUS || []).indexOf(p.status) === -1) throw new Error('Invalid status: ' + p.status);

  // Same lock as the matching engine, so a re-match running at the same time cannot
  // overwrite this status change, and row numbers cannot shift under a delete.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const m = readAll_('MATCHES').find(function (x) { return String(x.match_id) === String(p.matchId); });
    if (!m) throw new Error('Match not found');
    if (!canSeeMatch_(m, mapBy_(readAll_('BUYERS'), 'buyer_id'), mapBy_(readAll_('VEHICLES'), 'vehicle_id'), user)) {
      throw new Error('This match does not involve your customers');
    }

    m.status = p.status;
    m.notes = str_(p.notes);
    m.updated_at = new Date();
    m.updated_by = user.username;
    writeRow_(sheet_('MATCHES'), 'MATCHES', m._row, m);

    // On a Deal: buyer = Bought, vehicle = Sold
    let closed = false;
    if (isDeal_(p.status)) {
      const b = findById_('BUYERS', 'buyer_id', m.buyer_id);
      const v = findById_('VEHICLES', 'vehicle_id', m.vehicle_id);
      if (b) { b.status = MATCH_CONFIG.BUYER_DONE; b.updated_at = new Date(); writeRow_(sheet_('BUYERS'), 'BUYERS', b._row, b); }
      if (v) { v.status = MATCH_CONFIG.VEHICLE_DONE; v.updated_at = new Date(); writeRow_(sheet_('VEHICLES'), 'VEHICLES', v._row, v); }
      closed = true;
    }
    SpreadsheetApp.flush();
    return { ok: true, closed: closed };
  } finally {
    lock.releaseLock();
  }
}

function enrichMatch_(m, bMap, vMap, user, officers) {
  const b = bMap[String(m.buyer_id)] || { buyer_id: m.buyer_id };
  const v = vMap[String(m.vehicle_id)] || { vehicle_id: m.vehicle_id };
  return {
    matchId: String(m.match_id),
    score: Number(m.score),
    status: String(m.status || ''),
    notes: String(m.notes || ''),
    updatedAt: m.updated_at instanceof Date ? Utilities.formatDate(m.updated_at, APP.TZ, 'yyyy-MM-dd HH:mm') : '',
    reasons: (b.name !== undefined && v.make !== undefined) ? scoreMatch_(b, v).reasons : [],
    buyer: viewRecord_(b, 'B', user, officers, true),
    vehicle: viewRecord_(v, 'V', user, officers, true)
  };
}

// ============================================================
//  HELPERS
// ============================================================
/**
 * Status checks that ignore symbols/emoji and letter case, so "Deal ✅", "Deal", "deal ✔️"
 * all count as a deal (the sheet may contain slightly different versions of the same word).
 */
function statusKey_(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '').toLowerCase(); }
function isDeal_(s) { return statusKey_(s) === statusKey_(MATCH_CONFIG.STATUS.DEAL); }
function isRejectedMatch_(s) { return statusKey_(s) === statusKey_(MATCH_CONFIG.STATUS.REJECTED); }
function isNewMatch_(s) { return !s || statusKey_(s) === statusKey_(MATCH_CONFIG.STATUS.NEW); }

function isBuyerActive_(b) {
  return !b.status || n_(b.status) === n_(MATCH_CONFIG.BUYER_ACTIVE);
}
function isVehicleAvailable_(v) {
  return !v.status || n_(v.status) === n_(MATCH_CONFIG.VEHICLE_ACTIVE);
}
function n_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-\/]+/g, '');
}
function num_(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) || n === 0 ? null : n;
}

/** Runs refreshAllMatches every hour (run this once). */
function installHourlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'refreshAllMatches'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshAllMatches').timeBased().everyHours(1).create();
  return '✅ Hourly trigger installed';
}

/**
 * ============================================================
 *  VEHICLE MATCH — Code.gs  (Main server file)
 * ============================================================
 *  Google Apps Script web app that matches vehicle buyers with sellers.
 *
 *  Files required in the Apps Script project:
 *    Code.gs      ← this file (setup, login, save, lists, dashboard)
 *    Matching.gs  ← matching engine
 *    Index.html   ← the complete UI
 *
 *  First time: select the `setup` function in the editor and click ▶ Run.
 *  Default login → username: admin   password: admin123  (change it right away!)
 * ============================================================
 */

const APP = {
  NAME: 'VehicleHub',
  VERSION: '3.5',   // must match MATCH_CONFIG.VERSION in Matching.gs and APP_VERSION in Index.html
  TZ: 'Asia/Colombo',
  SESSION_SECONDS: 6 * 60 * 60, // 6 hours (CacheService maximum)
  // Privacy: in matches, customers of OTHER officers are hidden — only the officer's
  // name, phone and the vehicle details are shown. Set true to let admins see everyone.
  ADMIN_SEES_ALL_CUSTOMERS: false,
  // Self-registration from the login page. New accounts stay inactive until an admin approves them.
  ALLOW_REGISTRATION: true,
  REQUIRE_APPROVAL: true,
  // Vehicles added by officers (staff) stay "Pending" until an admin approves them.
  // Pending vehicles are not matched. Vehicles added by admins are approved automatically.
  VEHICLE_APPROVAL: true,
  // Email alerts: when a NEW match is found, both officers get an email (free, via Gmail).
  // Only matches with at least this score are emailed. Officers add their email in Settings.
  EMAIL_ALERTS: true,
  EMAIL_MIN_SCORE: 70,
  APP_URL: 'https://drcjayawardena.github.io/VehicleHUB/',
  // Public request form (request.html): customers send "want to buy / want to sell" leads.
  // A lead goes to the officer in the link (?ref=username); otherwise round-robin between officers.
  LEADS_ENABLED: true,
  LEAD_ROUND_ROBIN_ROLES: ['staff', 'admin'],   // who takes part in round-robin
  LEAD_MAX_PHOTOS: 5,
  LEAD_CONFIRM_EMAIL: true,                    // email the customer a confirmation (if they give an email)
  // Public showroom (vehicles.html): approved vehicles ticked "Show on website" + a Wanted board of buyer needs
  // (no names / phone numbers). PUBLIC_PHONE = number shown for Call / WhatsApp ('' = first admin's number).
  PUBLIC_PHONE: ''
};

// Fields that other officers may see (no customer name / phone / notes)
const PUBLIC_FIELDS = {
  B: ['buyer_id', 'vehicle_type', 'make', 'model', 'year_from', 'year_to', 'min_budget',
      'max_budget', 'fuel', 'transmission', 'district', 'status'],
  V: ['vehicle_id', 'vehicle_type', 'make', 'model', 'year', 'price', 'mileage', 'fuel',
      'transmission', 'color', 'district', 'condition', 'status', 'photo_count']
};

// ---------- Sheet structure ----------
const SCHEMA = {
  USERS: ['username', 'password_hash', 'full_name', 'role', 'active', 'created_at', 'phone', 'approved_at', 'email'],
  BUYERS: ['buyer_id', 'name', 'phone', 'phone2', 'vehicle_type', 'make', 'model',
    'year_from', 'year_to', 'min_budget', 'max_budget', 'fuel', 'transmission',
    'district', 'notes', 'status', 'created_at', 'updated_at', 'created_by', 'show_wanted'],
  VEHICLES: ['vehicle_id', 'owner_name', 'owner_phone', 'phone2', 'vehicle_type', 'make',
    'model', 'year', 'price', 'mileage', 'fuel', 'transmission', 'color', 'district',
    'condition', 'notes', 'status', 'created_at', 'updated_at', 'created_by',
    'photos_url', 'photo_count', 'thumb_id', 'cover_id', 'approved_by', 'approved_at', 'show_public'],
  VEHICLE_MASTER: ['vehicle_type', 'make', 'model'],
  DROPDOWN_LISTS: ['list_name', 'value'],
  MATCHES: ['match_id', 'buyer_id', 'vehicle_id', 'score', 'status', 'notes',
    'follow_up', 'created_at', 'updated_at', 'updated_by'], // follow_up: no longer used (kept for compatibility with existing sheets)
  LEADS: ['lead_id', 'type', 'name', 'phone', 'email', 'vehicle_type', 'make', 'model', 'year_from', 'year_to',
    'year', 'min_budget', 'max_budget', 'price', 'leasing', 'notes', 'photos_url', 'photo_count', 'source', 'ref',
    'lang', 'status', 'assigned_to', 'created_at', 'updated_at', 'handled_by', 'converted_id', 'reject_reason', 'about']
};

// Columns stored as plain text so leading zeros are not lost
const TEXT_COLS = {
  USERS: ['username', 'password_hash', 'phone'],
  BUYERS: ['phone', 'phone2'],
  VEHICLES: ['owner_phone', 'phone2'],
  LEADS: ['phone']
};

// ---------- Default dropdown data (inserted once by setup) ----------
const DEFAULT_LISTS = {
  VEHICLE_TYPE: ['Car', 'SUV / Jeep', 'Van', 'Cab / Pickup', 'Motorcycle', 'Three Wheeler', 'Lorry', 'Bus'],
  FUEL: ['Petrol', 'Diesel', 'Hybrid', 'Electric'],
  TRANSMISSION: ['Auto', 'Manual', 'Tiptronic'],
  CONDITION: ['Brand New', 'Recondition', 'Registered (Used)'],
  DISTRICT: ['Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale', 'Nuwara Eliya', 'Galle',
    'Matara', 'Hambantota', 'Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu',
    'Batticaloa', 'Ampara', 'Trincomalee', 'Kurunegala', 'Puttalam', 'Anuradhapura',
    'Polonnaruwa', 'Badulla', 'Monaragala', 'Ratnapura', 'Kegalle'],
  BUYER_STATUS: ['Active', 'Bought', 'Cancelled'],
  VEHICLE_STATUS: ['Available', 'Pending', 'Rejected', 'Sold', 'Withdrawn'],
  // Note: 'New', 'Deal ✅' and 'Rejected ❌' must match MATCH_CONFIG.STATUS in Matching.gs
  MATCH_STATUS: ['New', 'Buyer Informed', 'Seller Informed', 'Vehicle Inspected',
    'Negotiating', 'Deal ✅', 'Rejected ❌']
};

const DEFAULT_MASTER = {
  'Car': {
    'Toyota': ['Aqua', 'Axio', 'Vitz', 'Prius', 'Premio', 'Allion', 'Corolla', 'Yaris', 'Belta', 'Passo'],
    'Suzuki': ['Wagon R', 'Alto', 'Swift', 'Celerio', 'Spacia'],
    'Honda': ['Fit', 'Grace', 'Civic', 'Insight'],
    'Nissan': ['Leaf', 'March', 'Sunny', 'Dayz', 'Note'],
    'Perodua': ['Axia', 'Bezza'],
    'Mitsubishi': ['Lancer'],
    'Daihatsu': ['Mira'],
    'Hyundai': ['Grand i10'],
    'Kia': ['Picanto'],
    'Micro': ['Panda']
  },
  'SUV / Jeep': {
    'Toyota': ['CHR', 'Raize', 'Rush', 'Land Cruiser Prado', 'RAV4'],
    'Honda': ['Vezel', 'CR-V'],
    'Mitsubishi': ['Montero', 'Outlander'],
    'Nissan': ['X-Trail'],
    'Suzuki': ['Vitara', 'Hustler'],
    'Kia': ['Sportage']
  },
  'Van': {
    'Toyota': ['HiAce', 'KDH', 'Townace', 'Noah'],
    'Nissan': ['Caravan', 'NV200', 'Vanette'],
    'Suzuki': ['Every'],
    'Mazda': ['Bongo']
  },
  'Cab / Pickup': {
    'Toyota': ['Hilux'],
    'Mitsubishi': ['L200'],
    'Nissan': ['Navara'],
    'Isuzu': ['D-Max'],
    'Mahindra': ['Bolero']
  },
  'Motorcycle': {
    'Honda': ['Dio', 'Hornet', 'CB Shine'],
    'Bajaj': ['Pulsar', 'CT 100', 'Discover', 'Platina'],
    'TVS': ['Apache', 'Ntorq', 'Wego', 'Scooty'],
    'Yamaha': ['FZ', 'Ray ZR'],
    'Hero': ['Pleasure', 'Maestro']
  },
  'Three Wheeler': {
    'Bajaj': ['RE'],
    'TVS': ['King'],
    'Piaggio': ['Ape']
  },
  'Lorry': {
    'Isuzu': ['Elf'],
    'Mitsubishi': ['Canter'],
    'Toyota': ['Dyna'],
    'Tata': ['Ace']
  },
  'Bus': {
    'Toyota': ['Coaster'],
    'Ashok Leyland': ['Viking'],
    'Tata': ['LP 909']
  }
};

// ============================================================
//  SETUP  (run once from the editor)
// ============================================================
function setup() {
  const ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) { ensureSheet_(ss, name); });

  // Dropdown lists
  if (sheet_('DROPDOWN_LISTS').getLastRow() < 2) {
    const rows = [];
    Object.keys(DEFAULT_LISTS).forEach(function (k) {
      DEFAULT_LISTS[k].forEach(function (v) { rows.push({ list_name: k, value: v }); });
    });
    appendRows_('DROPDOWN_LISTS', rows);
  }

  // Vehicle master
  if (sheet_('VEHICLE_MASTER').getLastRow() < 2) {
    const rows = [];
    Object.keys(DEFAULT_MASTER).forEach(function (type) {
      Object.keys(DEFAULT_MASTER[type]).forEach(function (make) {
        DEFAULT_MASTER[type][make].forEach(function (model) {
          rows.push({ vehicle_type: type, make: make, model: model });
        });
      });
    });
    appendRows_('VEHICLE_MASTER', rows);
  }

  // Default admin user
  if (sheet_('USERS').getLastRow() < 2) {
    appendObj_('USERS', {
      username: 'admin',
      password_hash: hash_('admin', 'admin123'),
      full_name: 'Administrator',
      role: 'admin',
      active: true,
      created_at: new Date()
    });
  }

  // Remove the empty default "Sheet1"
  ['Sheet1', 'Sheet 1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  migrateStatusNames_();
  ensureListValues_('VEHICLE_STATUS', ['Pending', 'Rejected']);
  makePhotoFoldersPrivate_();
  applyValidations_();
  const msg = '✅ Setup complete. Login: admin / admin123 (change the password right away)';
  Logger.log(msg);
  return msg;
}

/** Adds missing values to a dropdown list in DROPDOWN_LISTS (safe to run many times). */
function ensureListValues_(listName, values) {
  const have = (getLists_()[listName] || []).map(function (v) { return v.toLowerCase(); });
  const add = values.filter(function (v) { return have.indexOf(v.toLowerCase()) === -1; })
    .map(function (v) { return { list_name: listName, value: v }; });
  appendRows_('DROPDOWN_LISTS', add);
}

/** Renames the old Sinhala match statuses to English (safe to run many times). */
function migrateStatusNames_() {
  const MAP = {};
  MAP['Buyer \u0da7 \u0d9a\u0dd2\u0dc0\u0dca\u0dc0\u0dcf'] = 'Buyer Informed';
  MAP['Seller \u0da7 \u0d9a\u0dd2\u0dc0\u0dca\u0dc0\u0dcf'] = 'Seller Informed';
  MAP['\u0dc0\u0dcf\u0dc4\u0db1\u0dba \u0db6\u0dbd\u0db1\u0dca\u0db1 \u0d9c\u0dd2\u0dba\u0dcf'] = 'Vehicle Inspected';
  [['DROPDOWN_LISTS', 'value'], ['MATCHES', 'status']].forEach(function (x) {
    const sh = sheet_(x[0]);
    const last = sh.getLastRow();
    if (last < 2) return;
    const col = SCHEMA[x[0]].indexOf(x[1]) + 1;
    const rng = sh.getRange(2, col, last - 1, 1);
    const vals = rng.getValues();
    let changed = false;
    vals.forEach(function (r) { if (MAP[r[0]]) { r[0] = MAP[r[0]]; changed = true; } });
    if (changed) rng.setValues(vals);
  });
}

function ensureSheet_(ss, name) {
  const headers = SCHEMA[name];
  let sh = ss.getSheetByName(name);

  if (sh && sh.getLastRow() > 0) {
    const current = sh.getRange(1, 1, 1, headers.length).getValues()[0].map(String);
    if (current.join('|') === headers.join('|')) return sh; // already correct
    // Same structure with new columns added at the end → just add the new headers
    const used = current.filter(function (h) { return h !== ''; });
    if (used.length && used.join('|') === headers.slice(0, used.length).join('|') &&
        current.slice(used.length).every(function (h) { return h === ''; })) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
      (TEXT_COLS[name] || []).forEach(function (c) {
        sh.getRange(1, headers.indexOf(c) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
      });
      return sh;
    }
    // Old structure — rename it as a backup so no data is lost
    sh.setName(name + '_OLD_' + Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd_HHmm'));
    sh = null;
  }
  if (!sh) sh = ss.insertSheet(name);

  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  (TEXT_COLS[name] || []).forEach(function (c) {
    sh.getRange(1, headers.indexOf(c) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  return sh;
}

function applyValidations_() {
  const lists = getLists_();
  [['BUYERS', 'status', 'BUYER_STATUS'],
   ['VEHICLES', 'status', 'VEHICLE_STATUS'],
   ['MATCHES', 'status', 'MATCH_STATUS']].forEach(function (x) {
    const sh = sheet_(x[0]);
    const col = SCHEMA[x[0]].indexOf(x[1]) + 1;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(lists[x[2]] || [], true).setAllowInvalid(true).build();
    sh.getRange(2, col, sh.getMaxRows() - 1, 1).setDataValidation(rule);
  });
}

// ============================================================
//  WEB APP ENTRY
// ============================================================
function doGet(e) {
  if (e && e.parameter && e.parameter.ping) return json_({ ok: true, app: APP.NAME, versions: versions_() });
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * JSON API for the website hosted on GitHub Pages.
 * The page sends: POST { fn: "api" | "login" | "register" | "registrationOpen", args: [...] }
 * Only the functions listed here can be called from outside.
 */
function doPost(e) {
  const allowed = { api: api, login: login, register: register, registrationOpen: registrationOpen, submitLead: submitLead, publicListings: publicListings, publicThumbs: publicThumbs, publicPhotos: publicPhotos, publicPhoto: publicPhoto };
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = allowed[req.fn];
    if (!fn) throw new Error('Unknown function: ' + req.fn);
    out = { ok: true, result: fn.apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  AUTH
// ============================================================
function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  const u = readAll_('USERS').find(function (x) {
    return String(x.username).trim().toLowerCase() === username;
  });
  if (!u || String(u.password_hash) !== hash_(username, String(password || ''))) {
    Utilities.sleep(800);
    throw new Error('Incorrect username or password');
  }
  if (!isTrue_(u.active)) {
    throw new Error(u.approved_at ? 'This account has been deactivated. Please contact the admin.'
                                  : 'Your account is waiting for admin approval.');
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  const sess = { username: String(u.username), full_name: String(u.full_name || u.username), role: String(u.role || 'staff') };
  CacheService.getScriptCache().put('S_' + token, JSON.stringify(sess), APP.SESSION_SECONDS);
  return { token: token, user: sess };
}

/** Public: create an account from the login page (inactive until an admin approves it). */
function register(p) {
  if (!APP.ALLOW_REGISTRATION) throw new Error('Registration is closed. Please contact the admin.');
  p = p || {};
  const username = str_(p.username).toLowerCase();
  const full_name = str_(p.full_name);
  const phone = normPhone_(p.phone);
  if (!full_name) throw new Error('Please enter your full name');
  if (!/^[a-z0-9._-]{3,}$/.test(username)) throw new Error('Username must be 3+ characters (a-z, 0-9 only)');
  if (phone.length !== 10) throw new Error('Please enter a valid mobile number (07XXXXXXXX)');
  if (String(p.password || '').length < 6) throw new Error('Password must be at least 6 characters');
  const email = cleanEmail_(p.email);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const users = readAll_('USERS');
    if (users.some(function (x) { return String(x.username).toLowerCase() === username; })) {
      throw new Error('That username is already taken');
    }
    if (users.some(function (x) { return normPhone_(x.phone) === phone; })) {
      throw new Error('An account with this mobile number already exists');
    }
    const now = new Date();
    appendObj_('USERS', {
      username: username,
      password_hash: hash_(username, String(p.password)),
      full_name: full_name,
      role: 'staff',
      active: !APP.REQUIRE_APPROVAL,
      created_at: now,
      phone: phone,
      approved_at: APP.REQUIRE_APPROVAL ? '' : now,
      email: email
    });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, needsApproval: APP.REQUIRE_APPROVAL };
}

/** Public: tells the login page whether to show "Create an account". */
function registrationOpen() { return APP.ALLOW_REGISTRATION; }

function getSession_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const raw = cache.get('S_' + token);
  if (!raw) return null;
  cache.put('S_' + token, raw, APP.SESSION_SECONDS); // sliding expiry
  return JSON.parse(raw);
}

function hash_(username, password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(username).toLowerCase() + '|' + password + '|' + salt_(),
    Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function salt_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('PW_SALT');
  if (!s) { s = Utilities.getUuid(); props.setProperty('PW_SALT', s); }
  return s;
}

// ============================================================
//  API DISPATCHER — every request from the UI comes through here
// ============================================================
function api(token, action, payload) {
  const user = getSession_(token);
  if (!user) throw new Error('SESSION_EXPIRED');

  const handlers = {
    init: init_,
    dashboard: dashboard_,
    lookupPhone: lookupPhone_,
    listBuyers: listBuyers_,
    listVehicles: listVehicles_,
    saveBuyer: saveBuyer_,
    saveVehicle: saveVehicle_,
    getMatches: getMatches_,
    updateMatch: updateMatch_,
    refreshMatches: function () { return refreshAllMatches(); },
    changePassword: changePassword_,
    updateProfile: updateProfile_,
    addUser: addUser_,
    listUsers: listUsers_,
    updateUser: updateUser_,
    addMaster: addMaster_,
    uploadPhoto: uploadPhoto_,
    getThumbs: getThumbs_,
    approveVehicle: approveVehicle_,
    listDeals: listDeals_,
    listPhotos: listPhotos_,
    getPhoto: getPhoto_,
    deletePhoto: deletePhoto_,
    deleteRecord: deleteRecord_,
    testEmail: testEmail_,
    listLeads: listLeads_,
    updateLead: updateLead_,
    leadPhotos: leadPhotos_,
    logout: function () { CacheService.getScriptCache().remove('S_' + token); return { ok: true }; }
  };
  const h = handlers[action];
  if (!h) throw new Error('Unknown action: ' + action);
  // JSON roundtrip so Dates etc. can be sent to the browser
  return JSON.parse(JSON.stringify(h(payload || {}, user)));
}

// ============================================================
//  HANDLERS
// ============================================================
/** Version of each server file — lets the app warn when one file was not updated. */
function versions_() {
  let matching = 'old';
  try { matching = MATCH_CONFIG.VERSION || 'old'; } catch (e) {}
  return { code: APP.VERSION, matching: matching };
}

function init_(p, user) {
  const me = officersMap_()[user.username.toLowerCase()] || {};
  return {
    versions: versions_(),
    user: Object.assign({}, user, { full_name: me.name || user.full_name, phone: me.phone || '', email: me.email || '' }),
    lists: getLists_(),
    formUrl: APP.APP_URL + 'request.html',
    master: readAll_('VEHICLE_MASTER').map(function (m) {
      return { vehicle_type: String(m.vehicle_type), make: String(m.make), model: String(m.model) };
    })
  };
}

function dashboard_(p, user) {
  const allB = readAll_('BUYERS'), allV = readAll_('VEHICLES');
  const bMap = mapBy_(allB, 'buyer_id');
  const vMap = mapBy_(allV, 'vehicle_id');
  const officers = officersMap_();
  // Officers see their own numbers; admins see everything
  const buyers = isAdmin_(user) ? allB : allB.filter(function (b) { return isMine_(b, user); });
  const vehicles = isAdmin_(user) ? allV : allV.filter(function (v) { return isMine_(v, user); });
  const matches = readAll_('MATCHES').filter(function (m) { return canSeeMatch_(m, bMap, vMap, user); });
  const month = fmtDay_(new Date()).slice(0, 7);
  const S = MATCH_CONFIG.STATUS;

  const live = matches.filter(function (m) {
    const b = bMap[String(m.buyer_id)], v = vMap[String(m.vehicle_id)];
    return b && v && isBuyerActive_(b) && isVehicleAvailable_(v);
  });

  const newOnes = live.filter(function (m) {
    return isNewMatch_(m.status) && Number(m.score) >= MATCH_CONFIG.MIN_SCORE;
  });

  return {
    pendingVehicles: isAdmin_(user) ? allV.filter(function (v) { return String(v.status) === 'Pending'; }).length : 0,
    pendingUsers: isAdmin_(user) ? readAll_('USERS').filter(function (u) {
      return !isTrue_(u.active) && !u.approved_at;
    }).length : 0,
    stats: {
      activeBuyers: buyers.filter(isBuyerActive_).length,
      availableVehicles: vehicles.filter(isVehicleAvailable_).length,
      newMatches: newOnes.length,
      inProgress: live.filter(function (m) {
        return !isNewMatch_(m.status) && !isDeal_(m.status) && !isRejectedMatch_(m.status);
      }).length,
      dealsThisMonth: dealsThisMonth_(matches, vehicles, month),
      newLeads: openLeadsFor_(user).filter(function (l) { return String(l.status) === 'New'; }).length
    },
    topNew: newOnes.map(function (m) { return enrichMatch_(m, bMap, vMap, user, officers); })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, 6)
  };
}

/**
 * Deals closed this month = matches marked "Deal" this month, plus vehicles marked "Sold"
 * this month without a Deal match (e.g. sold directly from the vehicle form). Each vehicle counts once.
 */
function dealsThisMonth_(matches, vehicles, month) {
  const when = function (r) { return fmtDay_(r.updated_at) || fmtDay_(r.approved_at) || fmtDay_(r.created_at); };
  const ids = {};
  matches.forEach(function (m) {
    if (isDeal_(m.status) && when(m).slice(0, 7) === month) ids['V:' + m.vehicle_id] = true;
  });
  vehicles.forEach(function (v) {
    if (statusKey_(v.status) === statusKey_(MATCH_CONFIG.VEHICLE_DONE) && when(v).slice(0, 7) === month) ids['V:' + v.vehicle_id] = true;
  });
  return Object.keys(ids).length;
}

/**
 * Closed deals with full details. p.month = 'yyyy-MM' (default: this month), or 'all'.
 * Includes Deal matches and vehicles marked Sold without a Deal match.
 */
function listDeals_(p, user) {
  const allB = readAll_('BUYERS'), allV = readAll_('VEHICLES'), users = readAll_('USERS');
  const bMap = mapBy_(allB, 'buyer_id'), vMap = mapBy_(allV, 'vehicle_id');
  const officers = officersMap_();
  const nameOf = function (u) { const o = officers[String(u || '').toLowerCase()]; return o ? o.name : String(u || ''); };
  const month = str_(p.month) || fmtDay_(new Date()).slice(0, 7);
  const when = function (r) { return fmtDay_(r.updated_at) || fmtDay_(r.approved_at) || fmtDay_(r.created_at); };
  const stamp = function (d) { return d instanceof Date ? Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd HH:mm') : String(d || ''); };
  const months = {}, deals = [], seen = {};

  readAll_('MATCHES').forEach(function (m) {
    if (!isDeal_(m.status) || !canSeeMatch_(m, bMap, vMap, user)) return;
    const d = when(m); if (d) months[d.slice(0, 7)] = true;
    seen[String(m.vehicle_id)] = true;
    if (month !== 'all' && d.slice(0, 7) !== month) return;
    const e = enrichMatch_(m, bMap, vMap, user, officers);
    e.kind = 'match';
    e.closedAt = stamp(m.updated_at) || d;
    e.closedBy = nameOf(m.updated_by);
    deals.push(e);
  });

  allV.forEach(function (v) {
    if (statusKey_(v.status) !== statusKey_(MATCH_CONFIG.VEHICLE_DONE) || seen[String(v.vehicle_id)]) return;
    if (!isAdmin_(user) && !isMine_(v, user)) return;
    const d = when(v); if (d) months[d.slice(0, 7)] = true;
    if (month !== 'all' && d.slice(0, 7) !== month) return;
    deals.push({
      kind: 'sold', matchId: '', score: null, notes: '',
      closedAt: stamp(v.updated_at) || d, closedBy: nameOf(v.created_by),
      buyer: null, vehicle: viewRecord_(v, 'V', user, officers, true)
    });
  });

  deals.sort(function (a, b) { return a.closedAt < b.closedAt ? 1 : -1; });
  const total = deals.reduce(function (t, d) { return t + (Number(d.vehicle && d.vehicle.price) || 0); }, 0);
  return { month: month, months: Object.keys(months).sort().reverse(), deals: deals, total: Math.round(total * 10) / 10 };
}

function lookupPhone_(p, user) {
  const phone = normPhone_(p.phone);
  if (phone.length < 9) throw new Error('Please enter a valid phone number');
  const officers = officersMap_();
  return {
    phone: phone,
    buyers: readAll_('BUYERS').filter(function (b) {
      return normPhone_(b.phone) === phone || normPhone_(b.phone2) === phone;
    }).map(function (b) { return viewRecord_(b, 'B', user, officers, false); }),
    vehicles: readAll_('VEHICLES').filter(function (v) {
      return normPhone_(v.owner_phone) === phone || normPhone_(v.phone2) === phone;
    }).map(function (v) { return viewRecord_(v, 'V', user, officers, false); })
  };
}

/** Officers see only their own customers; admins see all. */
function listBuyers_(p, user) {
  const counts = matchCounts_('buyer_id');
  const officers = officersMap_();
  return {
    buyers: readAll_('BUYERS')
      .filter(function (b) { return isAdmin_(user) || isMine_(b, user); })
      .map(function (b) {
        const o = viewRecord_(b, 'B', user, officers, false);
        o.matchCount = counts[String(b.buyer_id)] || 0;
        return o;
      }).reverse()
  };
}

function listVehicles_(p, user) {
  const counts = matchCounts_('vehicle_id');
  const officers = officersMap_();
  return {
    vehicles: readAll_('VEHICLES')
      .filter(function (v) { return isAdmin_(user) || isMine_(v, user); })
      .map(function (v) {
        const o = viewRecord_(v, 'V', user, officers, false);
        o.matchCount = counts[String(v.vehicle_id)] || 0;
        return o;
      }).reverse()
  };
}

function matchCounts_(key) {
  const c = {};
  readAll_('MATCHES').forEach(function (m) {
    if (Number(m.score) >= MATCH_CONFIG.MIN_SCORE && !isRejectedMatch_(m.status)) {
      const k = String(m[key]);
      c[k] = (c[k] || 0) + 1;
    }
  });
  return c;
}

// ---------- Save buyer ----------
function saveBuyer_(p, user) {
  const d = {
    buyer_id: str_(p.buyer_id),
    name: str_(p.name),
    phone: normPhone_(p.phone),
    phone2: normPhone_(p.phone2),
    vehicle_type: str_(p.vehicle_type),
    make: str_(p.make),
    model: str_(p.model),
    year_from: numOrBlank_(p.year_from),
    year_to: numOrBlank_(p.year_to),
    min_budget: numOrBlank_(p.min_budget),
    max_budget: numOrBlank_(p.max_budget),
    fuel: str_(p.fuel),
    transmission: str_(p.transmission),
    district: str_(p.district),
    notes: str_(p.notes),
    status: str_(p.status) || 'Active',
    show_wanted: p.show_wanted === 'No' ? 'No' : 'Yes'
  };
  if (!d.name) throw new Error('Please enter the name');
  if (d.phone.length < 9) throw new Error('Please enter a valid phone number');
  if (d.max_budget === '') throw new Error('Please enter the maximum budget (Lakhs)');
  swapIfReversed_(d, 'year_from', 'year_to');
  swapIfReversed_(d, 'min_budget', 'max_budget');
  const master = d.make ? ensureMaster_(d.vehicle_type, d, 'make', 'model') : null;

  const id = saveRecord_('BUYERS', 'buyer_id', 'B', d, user);
  if (p.lead_id) convertLead_(p.lead_id, id, user);
  matchForBuyer_(id);
  return {
    id: id,
    master: master,
    buyer: viewRecord_(findById_('BUYERS', 'buyer_id', id), 'B', user, officersMap_(), false),
    matches: getMatches_({ buyerId: id }, user).matches
  };
}

// ---------- Save vehicle ----------
function saveVehicle_(p, user) {
  const d = {
    vehicle_id: str_(p.vehicle_id),
    owner_name: str_(p.owner_name),
    owner_phone: normPhone_(p.owner_phone),
    phone2: normPhone_(p.phone2),
    vehicle_type: str_(p.vehicle_type),
    make: str_(p.make),
    model: str_(p.model),
    year: numOrBlank_(p.year),
    price: numOrBlank_(p.price),
    mileage: numOrBlank_(p.mileage),
    fuel: str_(p.fuel),
    transmission: str_(p.transmission),
    color: str_(p.color),
    district: str_(p.district),
    condition: str_(p.condition),
    notes: str_(p.notes),
    status: str_(p.status) || 'Available',
    show_public: p.show_public === 'Yes' ? 'Yes' : 'No'
  };
  if (!d.owner_name) throw new Error("Please enter the owner's name");
  if (d.owner_phone.length < 9) throw new Error('Please enter a valid phone number');
  if (!d.vehicle_type || !d.make || !d.model) throw new Error('Please enter Type, Make and Model');
  if (d.price === '') throw new Error('Please enter the price (Lakhs)');
  const master = ensureMaster_(d.vehicle_type, d, 'make', 'model');

  // ---- Approval rules ----
  const ex = d.vehicle_id ? findById_('VEHICLES', 'vehicle_id', d.vehicle_id) : null;
  if (APP.VEHICLE_APPROVAL && !isAdmin_(user)) {
    const cur = ex ? String(ex.status || '') : '';
    if (!ex || cur === 'Pending' || cur === 'Rejected') {
      d.status = 'Pending';                 // new or re-submitted → waits for admin
    } else if (d.status === 'Pending' || d.status === 'Rejected' || !d.status) {
      d.status = cur;                        // officers cannot change approval themselves
    }
  } else if (!ex) {
    d.approved_by = user.username;           // admin-added → approved straight away
    d.approved_at = new Date();
  }

  const id = saveRecord_('VEHICLES', 'vehicle_id', 'V', d, user);
  if (p.lead_id) convertLead_(p.lead_id, id, user);   // also moves the customer's photos to the vehicle
  matchForVehicle_(id);
  const saved = findById_('VEHICLES', 'vehicle_id', id);
  return {
    id: id,
    pending: String(saved.status) === 'Pending',
    master: master,
    vehicle: viewRecord_(saved, 'V', user, officersMap_(), false),
    matches: getMatches_({ vehicleId: id }, user).matches
  };
}

/** Insert (no id) or update (id given). Returns the ID. */
function saveRecord_(sheetName, idCol, prefix, d, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now = new Date();
    if (d[idCol]) {
      const ex = readAll_(sheetName).find(function (r) { return String(r[idCol]) === d[idCol]; });
      if (!ex) throw new Error('Record not found: ' + d[idCol]);
      if (!isAdmin_(user) && !isMine_(ex, user)) throw new Error('You can only edit your own customers');
      const obj = Object.assign({}, ex, d, { updated_at: now });
      writeRow_(sheet_(sheetName), sheetName, ex._row, obj);
      SpreadsheetApp.flush();
      return d[idCol];
    }
    const id = nextId_(sheetName, idCol, prefix);
    d[idCol] = id;
    appendObj_(sheetName, Object.assign({}, d, { created_at: now, updated_at: now, created_by: user.username }));
    SpreadsheetApp.flush();
    return id;
  } finally {
    lock.releaseLock();
  }
}

// ---------- Users ----------
function changePassword_(p, user) {
  const newPw = String(p.newPassword || '');
  if (newPw.length < 6) throw new Error('New password must be at least 6 characters');
  const u = readAll_('USERS').find(function (x) { return String(x.username).toLowerCase() === user.username.toLowerCase(); });
  if (!u || String(u.password_hash) !== hash_(user.username, String(p.oldPassword || ''))) {
    throw new Error('Current password is incorrect');
  }
  u.password_hash = hash_(user.username, newPw);
  writeRow_(sheet_('USERS'), 'USERS', u._row, u);
  return { ok: true };
}

function addUser_(p, user) {
  if (user.role !== 'admin') throw new Error('Only admins can add users');
  const username = str_(p.username).toLowerCase();
  if (!/^[a-z0-9._-]{3,}$/.test(username)) throw new Error('Username must be 3+ characters (a-z, 0-9 only)');
  if (String(p.password || '').length < 6) throw new Error('Password must be at least 6 characters');
  if (normPhone_(p.phone).length < 9) throw new Error('Please enter a valid mobile number for the user');
  if (readAll_('USERS').some(function (x) { return String(x.username).toLowerCase() === username; })) {
    throw new Error('That username already exists');
  }
  appendObj_('USERS', {
    username: username,
    password_hash: hash_(username, String(p.password)),
    full_name: str_(p.full_name) || username,
    role: p.role === 'admin' ? 'admin' : 'staff',
    active: true,
    created_at: new Date(),
    phone: normPhone_(p.phone),
    approved_at: new Date(),
    email: cleanEmail_(p.email)
  });
  return { ok: true };
}

/** Officer updates their own display name and contact number. */
function updateProfile_(p, user) {
  const phone = normPhone_(p.phone);
  if (phone.length < 9) throw new Error('Please enter a valid phone number');
  const u = readAll_('USERS').find(function (x) { return String(x.username).toLowerCase() === user.username.toLowerCase(); });
  if (!u) throw new Error('User not found');
  u.full_name = str_(p.full_name) || u.full_name;
  u.phone = phone;
  if (p.email !== undefined) u.email = cleanEmail_(p.email);
  writeRow_(sheet_('USERS'), 'USERS', u._row, u);
  return { ok: true, full_name: String(u.full_name), phone: phone, email: String(u.email || '') };
}

/** Admin: list all users (without password hashes). */
function listUsers_(p, user) {
  if (!isAdmin_(user)) throw new Error('Only admins can manage users');
  return {
    users: readAll_('USERS').map(function (u) {
      return { username: String(u.username), full_name: String(u.full_name || ''), phone: normPhone_(u.phone),
               email: String(u.email || ''),
               role: String(u.role || 'staff'), active: isTrue_(u.active),
               pending: !isTrue_(u.active) && !u.approved_at };
    })
  };
}

/** Admin: edit a user's name, mobile, role, active flag, or reset the password. */
function updateUser_(p, user) {
  if (!isAdmin_(user)) throw new Error('Only admins can manage users');
  const u = readAll_('USERS').find(function (x) { return String(x.username).toLowerCase() === str_(p.username).toLowerCase(); });
  if (!u) throw new Error('User not found');
  const phone = normPhone_(p.phone);
  if (phone.length < 9) throw new Error('Please enter a valid mobile number');
  if (String(u.username).toLowerCase() === user.username.toLowerCase() && (!p.active || p.role !== 'admin')) {
    throw new Error('You cannot deactivate yourself or remove your own admin role');
  }
  u.full_name = str_(p.full_name) || u.full_name;
  u.phone = phone;
  if (p.email !== undefined) u.email = cleanEmail_(p.email);
  u.role = p.role === 'admin' ? 'admin' : 'staff';
  u.active = !!p.active;
  if (u.active && !u.approved_at) u.approved_at = new Date();
  if (p.newPassword) {
    if (String(p.newPassword).length < 6) throw new Error('Password must be at least 6 characters');
    u.password_hash = hash_(u.username, String(p.newPassword));
  }
  writeRow_(sheet_('USERS'), 'USERS', u._row, u);
  return { ok: true };
}

// ============================================================
//  VEHICLE MAKES & MODELS (VEHICLE_MASTER)
// ============================================================
/**
 * Makes sure type/make/model exist in VEHICLE_MASTER (adds them if new) and fixes the
 * spelling in `d` to match the existing list (e.g. "toyota" → "Toyota").
 * Returns the updated master list if something was added, otherwise null.
 */
function ensureMaster_(type, d, makeKey, modelKey) {
  const rows = readAll_('VEHICLE_MASTER');
  const make = str_(d[makeKey]), model = str_(d[modelKey]);
  if (!make) return null;
  const sameMake = rows.find(function (r) { return n_(r.make) === n_(make); });
  if (sameMake) d[makeKey] = String(sameMake.make);
  if (model) {
    const sameModel = rows.find(function (r) { return n_(r.make) === n_(make) && n_(r.model) === n_(model); });
    if (sameModel) d[modelKey] = String(sameModel.model);
  }
  const exists = rows.some(function (r) {
    return n_(r.vehicle_type) === n_(type) && n_(r.make) === n_(make) && (model ? n_(r.model) === n_(model) : true);
  });
  if (exists || !type) return null;
  appendObj_('VEHICLE_MASTER', { vehicle_type: type, make: d[makeKey], model: model ? d[modelKey] : '' });
  return masterList_();
}

function masterList_() {
  return readAll_('VEHICLE_MASTER').map(function (m) {
    return { vehicle_type: String(m.vehicle_type), make: String(m.make), model: String(m.model) };
  });
}

/** Settings → add a make and one or more models (comma / new-line separated). */
function addMaster_(p) {
  const type = str_(p.vehicle_type), make = str_(p.make);
  if (!type || !make) throw new Error('Please choose a vehicle type and enter the make');
  const models = String(p.models || '').split(/[,\n]+/).map(str_).filter(Boolean);
  let added = 0;
  (models.length ? models : ['']).forEach(function (model) {
    const d = { make: make, model: model };
    if (ensureMaster_(type, d, 'make', 'model')) added++;
  });
  return { added: added, master: masterList_() };
}

// ============================================================
//  VEHICLE PHOTOS (Google Drive)
// ============================================================
/** Uploads one photo (data URL) for a vehicle into its own Drive folder. */
function uploadPhoto_(p, user) {
  const m = String(p.data || '').match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid image file');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Photo is too large (max 10 MB)');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const v = findById_('VEHICLES', 'vehicle_id', p.vehicleId);
    if (!v) throw new Error('Vehicle not found');
    if (!isAdmin_(user) && !isMine_(v, user)) throw new Error('You can only add photos to your own vehicles');

    const folder = vehicleFolder_(v);
    const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
    const name = v.vehicle_id + '_' + Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd_HHmmss') +
      '_' + Math.floor(Math.random() * 1000) + '.' + ext;
    const file = folder.createFile(Utilities.newBlob(bytes, m[1], name));

    // Small cover thumbnail (made in the browser) — kept once per vehicle
    const tm = String(p.thumb || '').match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (tm && !fileAlive_(v.thumb_id)) {
      const tb = Utilities.base64Decode(tm[2]);
      if (tb.length < 300 * 1024) {
        const t = thumbsFolder_().createFile(Utilities.newBlob(tb, tm[1], v.vehicle_id + '_thumb.jpg'));
        v.thumb_id = t.getId();
        v.cover_id = file.getId();
      }
    }

    let count = 0;
    const it = folder.getFiles();
    while (it.hasNext()) { const g = it.next(); if (!g.isTrashed || !g.isTrashed()) count++; }
    v.photos_url = folder.getUrl();
    v.photo_count = count;
    writeRow_(sheet_('VEHICLES'), 'VEHICLES', v._row, v);
    return { photo_count: count };
  } finally {
    lock.releaseLock();
  }
}

function photosRoot_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_ROOT_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted → recreate */ } }
  const f = DriveApp.createFolder('Vehicle Match Photos');
  props.setProperty('PHOTO_ROOT_ID', f.getId());
  return f;
}

function vehicleFolder_(v) {
  const m = String(v.photos_url || '').match(/folders\/([\w-]+)/);
  if (m) { try { return DriveApp.getFolderById(m[1]); } catch (e) { /* recreate */ } }
  // The folder stays PRIVATE — photos are shown only inside the app, never through a Drive link.
  return photosRoot_().createFolder(v.vehicle_id + ' - ' + [v.make, v.model, v.year].filter(Boolean).join(' '));
}

/** Who may look at a vehicle's photos: its officer, admins, or an officer with a matching buyer. */
function canViewVehicle_(v, user) {
  if (isAdmin_(user) || isMine_(v, user)) return true;
  const bMap = mapBy_(readAll_('BUYERS'), 'buyer_id');
  return readAll_('MATCHES').some(function (m) {
    const b = bMap[String(m.buyer_id)];
    return String(m.vehicle_id) === String(v.vehicle_id) && b && isMine_(b, user);
  });
}

function photoFolderFor_(vehicleId, user) {
  const v = findById_('VEHICLES', 'vehicle_id', vehicleId);
  if (!v) throw new Error('Vehicle not found');
  if (!canViewVehicle_(v, user)) throw new Error('You do not have access to these photos');
  const m = String(v.photos_url || '').match(/folders\/([\w-]+)/);
  let folder = null;
  if (m) { try { folder = DriveApp.getFolderById(m[1]); } catch (e) {} }
  return { v: v, folder: folder };
}

/** List the photo IDs of a vehicle (no Drive links are sent to the browser). */
function listPhotos_(p, user) {
  const x = photoFolderFor_(p.vehicleId, user);
  const out = [];
  if (x.folder) {
    const it = x.folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (!f.isTrashed || !f.isTrashed()) out.push({ id: f.getId(), name: f.getName(), time: f.getDateCreated ? f.getDateCreated() : '' });
    }
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return { photos: out, canDelete: isAdmin_(user) || isMine_(x.v, user) };
}

/** One photo as a data URL — checked to really belong to this vehicle's folder. */
function getPhoto_(p, user) {
  const x = photoFolderFor_(p.vehicleId, user);
  if (!x.folder) throw new Error('No photos for this vehicle');
  const f = DriveApp.getFileById(String(p.fileId));
  const parents = f.getParents();
  let ok = false;
  while (parents.hasNext()) { if (parents.next().getId() === x.folder.getId()) ok = true; }
  if (!ok) throw new Error('Photo not found');
  const blob = f.getBlob();
  return { data: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

/** Officer / admin removes a photo (moved to Drive trash). */
function deletePhoto_(p, user) {
  const x = photoFolderFor_(p.vehicleId, user);
  if (!isAdmin_(user) && !isMine_(x.v, user)) throw new Error('You can only delete photos of your own vehicles');
  const f = DriveApp.getFileById(String(p.fileId));
  const parents = f.getParents();
  let ok = false;
  while (parents.hasNext()) { if (parents.next().getId() === x.folder.getId()) ok = true; }
  if (!ok) throw new Error('Photo not found');
  f.setTrashed(true);
  if (String(x.v.cover_id) === String(p.fileId)) {   // the cover photo was deleted → drop its thumbnail
    try { DriveApp.getFileById(String(x.v.thumb_id)).setTrashed(true); } catch (e) {}
    x.v.thumb_id = ''; x.v.cover_id = '';
  }
  let count = 0;
  const it = x.folder.getFiles();
  while (it.hasNext()) { const g = it.next(); if (!g.isTrashed || !g.isTrashed()) count++; }
  x.v.photo_count = count;
  writeRow_(sheet_('VEHICLES'), 'VEHICLES', x.v._row, x.v);
  return { photo_count: count };
}

// ---------- Thumbnails ----------
function thumbsFolder_() {
  const root = photosRoot_();
  const it = root.getFoldersByName('_thumbnails');
  return it.hasNext() ? it.next() : root.createFolder('_thumbnails');
}

function fileAlive_(id) {
  if (!id) return false;
  try { return !DriveApp.getFileById(String(id)).isTrashed(); } catch (e) { return false; }
}

/**
 * p.ids = ['V0001', ...] → { V0001: 'data:image/jpeg;base64,...' }
 * Only vehicles this user may see. Vehicles uploaded before thumbnails existed get
 * one from Drive's own preview, saved for next time.
 */
function getThumbs_(p, user) {
  const ids = (Array.isArray(p.ids) ? p.ids : []).slice(0, 60).map(String);
  const vMap = mapBy_(readAll_('VEHICLES'), 'vehicle_id');
  let viaMatch = null;
  const canSee = function (v) {
    if (isAdmin_(user) || isMine_(v, user)) return true;
    if (!viaMatch) {
      viaMatch = {};
      const bMap = mapBy_(readAll_('BUYERS'), 'buyer_id');
      readAll_('MATCHES').forEach(function (m) {
        const b = bMap[String(m.buyer_id)];
        if (b && isMine_(b, user)) viaMatch[String(m.vehicle_id)] = true;
      });
    }
    return !!viaMatch[String(v.vehicle_id)];
  };
  const out = {};
  ids.forEach(function (id) {
    const v = vMap[id];
    if (!v || !Number(v.photo_count) || !canSee(v)) return;
    let blob = null;
    if (fileAlive_(v.thumb_id)) { try { blob = DriveApp.getFileById(String(v.thumb_id)).getBlob(); } catch (e) {} }
    if (!blob) blob = makeThumbFromDrive_(v);
    if (blob) out[id] = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  });
  return { thumbs: out };
}

function makeThumbFromDrive_(v) {
  const m = String(v.photos_url || '').match(/folders\/([\w-]+)/);
  if (!m) return null;
  try {
    const it = DriveApp.getFolderById(m[1]).getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (f.isTrashed && f.isTrashed()) continue;
      const t = f.getThumbnail();          // Drive's own small preview (may be null for very new files)
      if (!t) return null;
      const saved = thumbsFolder_().createFile(t.setName(v.vehicle_id + '_thumb.png'));
      v.thumb_id = saved.getId(); v.cover_id = f.getId();
      writeRow_(sheet_('VEHICLES'), 'VEHICLES', v._row, v);
      return t;
    }
  } catch (e) {}
  return null;
}

// ---------- Vehicle approval ----------
/** Admin approves (→ Available, matching starts) or rejects (→ Rejected) a pending vehicle. */
function approveVehicle_(p, user) {
  if (!isAdmin_(user)) throw new Error('Only admins can approve vehicles');
  const v = findById_('VEHICLES', 'vehicle_id', p.vehicleId);
  if (!v) throw new Error('Vehicle not found');
  v.status = p.approve ? 'Available' : 'Rejected';
  v.approved_by = user.username;
  v.approved_at = new Date();
  if (!p.approve && str_(p.note)) v.notes = (str_(v.notes) ? str_(v.notes) + '\n' : '') + '[Rejected: ' + str_(p.note) + ']';
  v.updated_at = new Date();
  writeRow_(sheet_('VEHICLES'), 'VEHICLES', v._row, v);
  let matches = 0;
  if (p.approve) {
    matchForVehicle_(v.vehicle_id);
    matches = getMatches_({ vehicleId: v.vehicle_id }, user).matches.length;
  }
  return { ok: true, status: v.status, matches: matches };
}

/** Removes "anyone with the link" sharing from photo folders created by the older version. */
function makePhotoFoldersPrivate_() {
  readAll_('VEHICLES').forEach(function (v) {
    const m = String(v.photos_url || '').match(/folders\/([\w-]+)/);
    if (!m) return;
    try {
      const f = DriveApp.getFolderById(m[1]);
      f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      const it = f.getFiles();
      while (it.hasNext()) it.next().setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    } catch (e) { /* folder missing or sharing not allowed — skip */ }
  });
}

// ============================================================
//  OFFICERS & PRIVACY
// ============================================================
function isAdmin_(user) { return user.role === 'admin'; }

function isMine_(rec, user) {
  return String(rec.created_by || '').toLowerCase() === user.username.toLowerCase();
}

function officersMap_() {
  const m = {};
  readAll_('USERS').forEach(function (u) {
    m[String(u.username).toLowerCase()] = {
      username: String(u.username),
      name: String(u.full_name || u.username),
      phone: normPhone_(u.phone),
      email: String(u.email || '').trim(),
      active: isTrue_(u.active)
    };
  });
  return m;
}

function officerOf_(rec, officers) {
  const k = String(rec.created_by || '').toLowerCase();
  return officers[k] || { username: k, name: k || 'Unknown officer', phone: '' };
}

/**
 * Returns a copy of a buyer/vehicle safe to send to this user.
 * Own customers → full details. Other officers' customers → vehicle details + officer only.
 * forMatch = true applies the strict match rule (admins included unless ADMIN_SEES_ALL_CUSTOMERS).
 */
function viewRecord_(rec, kind, user, officers, forMatch) {
  const mine = isMine_(rec, user);
  const full = mine || (isAdmin_(user) && (!forMatch || APP.ADMIN_SEES_ALL_CUSTOMERS));
  let o;
  if (full) {
    o = Object.assign({}, rec);
  } else {
    o = {};
    PUBLIC_FIELDS[kind].forEach(function (k) { o[k] = rec[k]; });
  }
  delete o._row;
  delete o.photos_url; // never send Drive links to the browser — photos are shown in-app
  delete o.thumb_id; delete o.cover_id;
  o.mine = mine;
  o.masked = !full;
  o.officer = officerOf_(rec, officers);
  return o;
}

/** Officers only see matches that involve one of their own customers. */
function canSeeMatch_(m, bMap, vMap, user) {
  if (isAdmin_(user)) return true;
  const b = bMap[String(m.buyer_id)], v = vMap[String(m.vehicle_id)];
  return !!((b && isMine_(b, user)) || (v && isMine_(v, user)));
}

// ============================================================
//  SHEET HELPERS
// ============================================================
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error(name + ' sheet not found. Run setup() from the editor.');
  return sh;
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = SCHEMA[name];
  return sh.getRange(2, 1, last - 1, cols.length).getValues()
    .map(function (r, i) {
      const o = { _row: i + 2 };
      cols.forEach(function (c, j) { o[c] = r[j]; });
      return o;
    })
    .filter(function (o) { return o[cols[0]] !== '' && o[cols[0]] !== null; });
}

function findById_(name, idCol, id) {
  return readAll_(name).find(function (r) { return String(r[idCol]) === String(id); }) || null;
}

function writeRow_(sh, name, row, obj) {
  const cols = SCHEMA[name];
  (TEXT_COLS[name] || []).forEach(function (c) {
    sh.getRange(row, cols.indexOf(c) + 1).setNumberFormat('@');
  });
  sh.getRange(row, 1, 1, cols.length).setValues([cols.map(function (c) {
    return obj[c] === undefined || obj[c] === null ? '' : obj[c];
  })]);
}

function appendObj_(name, obj) {
  const sh = sheet_(name);
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  writeRow_(sh, name, row, obj);
  return row;
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name);
  const cols = SCHEMA[name];
  const start = sh.getLastRow() + 1;
  const need = start + objs.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 100);
  sh.getRange(start, 1, objs.length, cols.length).setValues(objs.map(function (o) {
    return cols.map(function (c) { return o[c] === undefined || o[c] === null ? '' : o[c]; });
  }));
}

function nextId_(name, idCol, prefix) {
  // The highest number ever issued is remembered, so an ID is never reused after a delete.
  const props = PropertiesService.getScriptProperties();
  const key = 'LAST_ID_' + name;
  let max = Number(props.getProperty(key)) || 0;
  readAll_(name).forEach(function (r) {
    const n = parseInt(String(r[idCol]).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  props.setProperty(key, String(max + 1));
  return prefix + ('0000' + (max + 1)).slice(-4);
}

/**
 * Admin only: permanently delete a buyer or vehicle together with all of its matches.
 * A vehicle's photo folder and thumbnail are moved to the Drive trash (recoverable for 30 days).
 * p = { kind: 'buyer' | 'vehicle', id: 'B0001' | 'V0001' }
 */
function deleteRecord_(p, user) {
  if (!isAdmin_(user)) throw new Error('Only an admin can delete records');
  const isBuyer = p.kind === 'buyer';
  const sheetName = isBuyer ? 'BUYERS' : 'VEHICLES';
  const idCol = isBuyer ? 'buyer_id' : 'vehicle_id';
  const id = str_(p.id);
  if (!id) throw new Error('Missing ID');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rec = findById_(sheetName, idCol, id);
    if (!rec) throw new Error('Record not found: ' + id);
    // Remember this number as used, so a new record never gets the deleted ID
    const props = PropertiesService.getScriptProperties(), key = 'LAST_ID_' + sheetName;
    const n = parseInt(id.replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > (Number(props.getProperty(key)) || 0)) props.setProperty(key, String(n));

    // 1. Matches of this record (bottom-up so row numbers stay valid)
    const msh = sheet_('MATCHES');
    const mrows = readAll_('MATCHES')
      .filter(function (m) { return String(m[idCol]) === id; })
      .map(function (m) { return m._row; })
      .sort(function (a, b) { return b - a; });
    mrows.forEach(function (r) { msh.deleteRow(r); });

    // 2. Photos (vehicle only) → Drive trash
    if (!isBuyer) {
      const m = String(rec.photos_url || '').match(/folders\/([\w-]+)/);
      if (m) { try { DriveApp.getFolderById(m[1]).setTrashed(true); } catch (e) {} }
      if (rec.thumb_id) { try { DriveApp.getFileById(String(rec.thumb_id)).setTrashed(true); } catch (e) {} }
    }

    // 3. The record itself
    sheet_(sheetName).deleteRow(rec._row);
    SpreadsheetApp.flush();
    return { ok: true, id: id, matchesDeleted: mrows.length };
  } finally {
    lock.releaseLock();
  }
}

function getLists_() {
  const lists = {};
  readAll_('DROPDOWN_LISTS').forEach(function (r) {
    const k = String(r.list_name).trim();
    if (!lists[k]) lists[k] = [];
    if (String(r.value).trim()) lists[k].push(String(r.value).trim());
  });
  return lists;
}

function mapBy_(arr, key) {
  const m = {};
  arr.forEach(function (o) { m[String(o[key])] = o; });
  return m;
}

// ============================================================
//  SMALL UTILS
// ============================================================
function str_(v) { return String(v == null ? '' : v).trim(); }

function numOrBlank_(v) {
  if (v === '' || v == null) return '';
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) || String(v).trim() === '' ? '' : n;
}

function swapIfReversed_(o, a, b) {
  if (o[a] !== '' && o[b] !== '' && Number(o[a]) > Number(o[b])) {
    const t = o[a]; o[a] = o[b]; o[b] = t;
  }
}

/** 0771234567 / 771234567 / +94 77 123 4567 → 0771234567 */
function normPhone_(p) {
  let d = String(p == null ? '' : p).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && d.indexOf('94') === 0) d = '0' + d.slice(2);
  else if (d.length === 9) d = '0' + d;
  return d;
}

function isTrue_(v) {
  return v === true || v === 1 || ['true', '1', 'yes'].indexOf(String(v).toLowerCase()) !== -1;
}

function fmtDay_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd');
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}


// ============================================================
//  EMAIL ALERTS — new matches are emailed to both officers
// ============================================================
function cleanEmail_(e) {
  const s = String(e || '').trim().toLowerCase();
  if (!s) return '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new Error('Please enter a valid email address');
  return s;
}

/** Officer: send a test alert to their own email (also checks Gmail permission / quota). */
function testEmail_(p, user) {
  const me = officersMap_()[user.username.toLowerCase()] || {};
  if (!me.email) throw new Error('Save your email in My officer profile first');
  MailApp.sendEmail({
    to: me.email,
    subject: APP.NAME + ' — test alert',
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px">' +
      '<h2 style="color:#1d3f8f;margin:0 0 8px">' + APP.NAME + '</h2>' +
      '<p>✅ Email alerts are working. You will get an email here when a new match is found for your customers.</p></div>',
    name: APP.NAME
  });
  return { ok: true, email: me.email, remaining: MailApp.getRemainingDailyQuota() };
}

/**
 * Called after new matches are saved. Sends ONE email per officer listing all of
 * their new matches (so a big refresh does not flood anyone). Never throws.
 * newRows: the MATCHES rows just added; bMap / vMap: buyer & vehicle objects by id.
 */
function notifyNewMatches_(newRows, bMap, vMap) {
  if (!APP.EMAIL_ALERTS || !newRows || !newRows.length) return 0;
  try {
    const officers = officersMap_();
    const perOfficer = {};   // username -> [{ side, m, b, v }]
    newRows.forEach(function (m) {
      if (Number(m.score) < APP.EMAIL_MIN_SCORE) return;
      const b = bMap[String(m.buyer_id)], v = vMap[String(m.vehicle_id)];
      if (!b || !v) return;
      const ob = String(b.created_by || '').toLowerCase(), ov = String(v.created_by || '').toLowerCase();
      (perOfficer[ob] = perOfficer[ob] || []).push({ side: 'buyer', m: m, b: b, v: v });
      if (ov !== ob) (perOfficer[ov] = perOfficer[ov] || []).push({ side: 'vehicle', m: m, b: b, v: v });
    });

    let sent = 0;
    Object.keys(perOfficer).forEach(function (k) {
      const o = officers[k];
      if (!o || !o.email || !o.active) return;
      if (MailApp.getRemainingDailyQuota() < 1) { Logger.log('Email quota used up — alert skipped for ' + k); return; }
      const items = perOfficer[k].sort(function (a, b) { return b.m.score - a.m.score; });
      try {
        MailApp.sendEmail({
          to: o.email,
          subject: APP.NAME + ' — ' + items.length + ' new match' + (items.length > 1 ? 'es' : '') +
            ' for your customer' + (items.length > 1 ? 's' : ''),
          htmlBody: matchEmailHtml_(o, items, officers),
          name: APP.NAME
        });
        sent++;
      } catch (e) { Logger.log('Alert email failed for ' + k + ': ' + e.message); }
    });
    return sent;
  } catch (e) {
    Logger.log('notifyNewMatches_ error: ' + e.message);
    return 0;
  }
}

function h_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function carText_(x, yearKey) {
  return [x.make, x.model, x[yearKey]].filter(function (s) { return String(s || '').trim(); }).join(' ') || String(x.vehicle_type || 'Vehicle');
}
function lakhs_(n) { return (n === '' || n == null) ? '-' : 'Rs. ' + n + ' Lakhs'; }

function matchEmailHtml_(o, items, officers) {
  const row = function (label, val) {
    return '<tr><td style="padding:3px 10px 3px 0;color:#667;white-space:nowrap">' + label +
      '</td><td style="padding:3px 0;color:#122">' + val + '</td></tr>';
  };
  const cards = items.map(function (it) {
    const b = it.b, v = it.v;
    const bOff = officerOf_(b, officers), vOff = officerOf_(v, officers);
    const want = carText_(b, 'x') + (b.year_from || b.year_to ? ' (' + (b.year_from || '…') + '–' + (b.year_to || '…') + ')' : '');
    const budget = (b.min_budget ? b.min_budget + '–' : '') + b.max_budget;
    let html = '<div style="border:1px solid #dde3ee;border-radius:10px;padding:12px 14px;margin:0 0 12px">' +
      '<div style="font-weight:bold;font-size:15px;margin-bottom:6px;color:#1d3f8f">' +
      h_(carText_(v, 'year')) + ' — ' + h_(lakhs_(v.price)) +
      ' <span style="background:#e7f6ec;color:#1b7a3d;border-radius:10px;padding:2px 8px;font-size:12px">' + it.m.score + '% match</span></div>' +
      '<table style="font-size:13px;border-collapse:collapse">';
    if (it.side === 'buyer') {
      html += row('Your buyer', h_(b.name) + ' · ' + h_(b.phone));
      html += row('Wants', h_(want) + ' · Budget ' + h_(lakhs_(budget)));
      html += row('Vehicle', h_([v.vehicle_type, v.condition, v.color].filter(String).join(' · ')));
      html += (vOff.username.toLowerCase() === o.username.toLowerCase())
        ? row('Seller', h_(v.owner_name) + ' · ' + h_(v.owner_phone) + ' (your customer)')
        : row('Seller\'s officer', h_(vOff.name) + ' · ' + h_(vOff.phone));
    } else {
      html += row('Your vehicle', h_(carText_(v, 'year')) + ' · ' + h_(v.owner_name) + ' · ' + h_(v.owner_phone));
      html += row('Buyer wants', h_(want) + ' · Budget ' + h_(lakhs_(budget)));
      html += row('Buyer\'s officer', h_(bOff.name) + ' · ' + h_(bOff.phone));
    }
    return html + '</table></div>';
  }).join('');

  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#122;max-width:560px">' +
    '<h2 style="color:#1d3f8f;margin:0 0 4px">' + APP.NAME + '</h2>' +
    '<p style="margin:0 0 14px">Hi ' + h_(o.name) + ', new matches were found for your customers:</p>' +
    cards +
    '<p style="margin:16px 0"><a href="' + APP.APP_URL + '" style="background:#1d3f8f;color:#fff;padding:10px 20px;' +
    'border-radius:8px;text-decoration:none;font-weight:bold">Open VehicleHub</a></p>' +
    '<p style="color:#889;font-size:12px">Contact the other officer before calling their customer. ' +
    'To stop these emails, clear your email in Settings → My officer profile.</p></div>';
}


// ============================================================
//  PUBLIC REQUEST FORM → LEADS
//  request.html (public, no login) → submitLead() → LEADS sheet
//  → assigned officer (link ref or round-robin) → Convert to Buyer / Vehicle
// ============================================================
const LEAD_STATUS = { NEW: 'New', CONTACTED: 'Contacted', CONVERTED: 'Converted', REJECTED: 'Rejected' };

/** PUBLIC: a customer submits the request form. Never returns any app data. */
function submitLead(p) {
  if (!APP.LEADS_ENABLED) throw new Error('The request form is closed');
  p = p || {};
  if (str_(p.website)) return { ok: true, ref: 'L0000' };        // honeypot filled → bot; pretend success

  const type = p.type === 'seller' ? 'seller' : (p.type === 'buyer' ? 'buyer' : '');
  if (!type) throw new Error('Please choose buy or sell');
  const name = str_(p.name).slice(0, 80);
  const phone = normPhone_(p.phone);
  if (!name) throw new Error('Please enter your name');
  if (!/^0\d{9}$/.test(phone)) throw new Error('Please enter a valid mobile number (07XXXXXXXX)');
  if (p.consent !== true) throw new Error('Please tick the consent box');
  const email = p.email ? cleanEmail_(p.email) : '';

  const d = {
    type: type, name: name, phone: phone, email: email,
    vehicle_type: str_(p.vehicle_type).slice(0, 40), make: str_(p.make).slice(0, 40), model: str_(p.model).slice(0, 40),
    year_from: numOrBlank_(p.year_from), year_to: numOrBlank_(p.year_to), year: numOrBlank_(p.year),
    min_budget: numOrBlank_(p.min_budget), max_budget: numOrBlank_(p.max_budget), price: numOrBlank_(p.price),
    leasing: p.leasing ? 'Yes' : 'No', notes: str_(p.notes).slice(0, 500),
    source: str_(p.source).slice(0, 40), ref: str_(p.ref).toLowerCase().slice(0, 40), lang: p.lang === 'en' ? 'en' : 'si',
    about: ''
  };
  // Enquiry from the showroom (V…) or an offer for a Wanted request (B…) → goes to that record's officer
  const about = str_(p.about).toUpperCase();
  if (/^V\d+$/.test(about)) {
    const v = findById_('VEHICLES', 'vehicle_id', about);
    if (v && isPublicVehicle_(v)) {
      d.about = about; d.ref = String(v.created_by || '').toLowerCase();
      d.notes = ('Enquiry about ' + about + ' (' + carText_(v, 'year') + ', ' + lakhs_(v.price) + '). ' + d.notes).trim().slice(0, 500);
    }
  } else if (/^B\d+$/.test(about)) {
    const b = findById_('BUYERS', 'buyer_id', about);
    if (b && isWantedBuyer_(b)) {
      d.about = about; d.ref = String(b.created_by || '').toLowerCase();
      d.notes = ('Offer for Wanted ' + about + ' (' + carText_(b, 'x') + ', budget ' + lakhs_(b.max_budget) + '). ' + d.notes).trim().slice(0, 500);
    }
  }
  if (type === 'buyer' && d.max_budget === '') throw new Error('Please enter your maximum budget (Lakhs)');
  if (type === 'seller' && (!d.make || !d.model || d.price === '')) throw new Error('Please enter the make, model and price');
  swapIfReversed_(d, 'year_from', 'year_to');
  swapIfReversed_(d, 'min_budget', 'max_budget');

  // Photos (seller only): max N, each max 2 MB, images only — checked before anything is saved
  const photos = type === 'seller' && Array.isArray(p.photos) ? p.photos.slice(0, APP.LEAD_MAX_PHOTOS) : [];
  const blobs = photos.map(function (u, i) {
    const m = String(u || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) throw new Error('Invalid photo');
    const bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > 2 * 1024 * 1024) throw new Error('A photo is too large');
    return { type: m[1], bytes: bytes, i: i };
  });

  // Rate limits: 3 per phone per hour, 30 per 10 minutes overall
  const cache = CacheService.getScriptCache();
  const kp = 'LEADP_' + phone, kg = 'LEADG_' + Math.floor(Date.now() / 600000);
  const np = Number(cache.get(kp) || 0), ng = Number(cache.get(kg) || 0);
  if (np >= 3) throw new Error('You have already sent a request. We will contact you soon.');
  if (ng >= 30) throw new Error('Too many requests right now. Please try again in a few minutes.');
  cache.put(kp, String(np + 1), 3600); cache.put(kg, String(ng + 1), 900);

  let id, officer;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    officer = assignLeadOfficer_(d.ref);
    id = nextId_('LEADS', 'lead_id', 'L');
    const now = new Date();
    d.lead_id = id; d.status = LEAD_STATUS.NEW; d.assigned_to = officer ? officer.username : '';
    d.created_at = now; d.updated_at = now;
    if (blobs.length) {
      const folder = leadsFolder_().createFolder(id + ' - ' + [d.make, d.model, d.year].filter(String).join(' '));
      blobs.forEach(function (b) {
        folder.createFile(Utilities.newBlob(b.bytes, b.type, id + '_' + (b.i + 1) + '.jpg'));
      });
      d.photos_url = folder.getUrl();
      d.photo_count = blobs.length;
    }
    appendObj_('LEADS', d);
  } finally {
    lock.releaseLock();
  }

  notifyLeadOfficer_(d, officer);
  confirmLeadToCustomer_(d, officer);
  return { ok: true, ref: id, officer: officer ? { name: officer.name, phone: officer.phone } : null };
}

/** Link owner (?ref=username) if active; otherwise the next officer in round-robin. */
function assignLeadOfficer_(ref) {
  const officers = officersMap_();
  const users = readAll_('USERS');
  const byName = {};
  users.forEach(function (u) { byName[String(u.username).toLowerCase()] = u; });
  if (ref && byName[ref] && isTrue_(byName[ref].active)) return officers[ref];

  const pool = users.filter(function (u) {
    return isTrue_(u.active) && APP.LEAD_ROUND_ROBIN_ROLES.indexOf(String(u.role || 'staff')) !== -1 && normPhone_(u.phone);
  }).map(function (u) { return String(u.username).toLowerCase(); }).sort();
  if (!pool.length) return null;
  const props = PropertiesService.getScriptProperties();
  const last = String(props.getProperty('LEAD_RR_LAST') || '');
  let next = pool[0];
  for (let i = 0; i < pool.length; i++) { if (pool[i] > last) { next = pool[i]; break; } }
  props.setProperty('LEAD_RR_LAST', next);
  return officers[next];
}

function leadsFolder_() {
  const root = photosRoot_();
  const it = root.getFoldersByName('_leads');
  return it.hasNext() ? it.next() : root.createFolder('_leads');
}

function leadText_(l) {
  if (l.type === 'buyer') {
    const want = [l.vehicle_type, l.make, l.model].filter(String).join(' ') || 'Any vehicle';
    const yrs = l.year_from || l.year_to ? ' (' + (l.year_from || '…') + '–' + (l.year_to || '…') + ')' : '';
    return 'Wants to BUY: ' + want + yrs + ' · Budget ' + lakhs_((l.min_budget ? l.min_budget + '–' : '') + l.max_budget) +
      (l.leasing === 'Yes' ? ' · Needs leasing' : '');
  }
  return 'Wants to SELL: ' + [l.vehicle_type, l.make, l.model, l.year].filter(String).join(' ') + ' · ' + lakhs_(l.price) +
    (Number(l.photo_count) ? ' · ' + l.photo_count + ' photo(s)' : '');
}

/** Email the assigned officer (or the admins, if nobody / no email). Never throws. */
function notifyLeadOfficer_(l, officer) {
  try {
    const all = officersMap_();
    let to = officer && officer.email && officer.active ? [officer.email] : [];
    if (!to.length) {
      to = readAll_('USERS').filter(function (u) { return String(u.role) === 'admin' && isTrue_(u.active) && String(u.email || '').trim(); })
        .map(function (u) { return String(u.email).trim(); });
    }
    if (!to.length || MailApp.getRemainingDailyQuota() < to.length) return;
    MailApp.sendEmail({
      to: to.join(','),
      subject: APP.NAME + ' — new customer request ' + l.lead_id + ' (' + (l.type === 'buyer' ? 'buyer' : 'seller') + ')',
      htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#122;max-width:560px">' +
        '<h2 style="color:#1d3f8f;margin:0 0 8px">New request ' + h_(l.lead_id) + '</h2>' +
        '<p style="font-size:15px"><b>' + h_(l.name) + '</b> · ' + h_(l.phone) + (l.email ? ' · ' + h_(l.email) : '') + '</p>' +
        '<p>' + h_(leadText_(l)) + '</p>' + (l.notes ? '<p style="color:#556">“' + h_(l.notes) + '”</p>' : '') +
        '<p style="color:#667;font-size:12px">Assigned to: ' + h_(officer ? officer.name : 'nobody (admins)') +
        (l.ref ? ' · via link of ' + h_(l.ref) : ' · round-robin') + (l.source ? ' · source: ' + h_(l.source) : '') + '</p>' +
        '<p style="margin:16px 0"><a href="' + APP.APP_URL + '" style="background:#1d3f8f;color:#fff;padding:10px 20px;' +
        'border-radius:8px;text-decoration:none;font-weight:bold">Open Leads in VehicleHub</a></p>' +
        '<p style="color:#889;font-size:12px">Please call the customer as soon as possible.</p></div>',
      name: APP.NAME
    });
  } catch (e) { Logger.log('notifyLeadOfficer_: ' + e.message); }
}

/** Customer confirmation: email (free) + WhatsApp template if Meta Cloud API is configured. Never throws. */
function confirmLeadToCustomer_(l, officer) {
  const si = l.lang !== 'en';
  const oName = officer ? officer.name : APP.NAME;
  const oPhone = officer ? officer.phone : '';
  if (APP.LEAD_CONFIRM_EMAIL && l.email) {
    try {
      if (MailApp.getRemainingDailyQuota() > 0) {
        const body = si
          ? '<p>ආයුබෝවන් ' + h_(l.name) + ',</p><p>ඔබගේ ඉල්ලීම අපට ලැබුණා. යොමු අංකය: <b>' + h_(l.lead_id) + '</b></p>' +
            '<p>' + h_(l.type === 'buyer' ? 'ඔබ සොයන වාහනය' : 'ඔබගේ වාහනය') + ' ගැන අපගේ නියෝජිත <b>' + h_(oName) + '</b>' +
            (oPhone ? ' (' + h_(oPhone) + ')' : '') + ' ඉක්මනින් ඔබ අමතනු ඇත.</p><p>ස්තූතියි,<br>' + APP.NAME + '</p>'
          : '<p>Hello ' + h_(l.name) + ',</p><p>We have received your request. Reference: <b>' + h_(l.lead_id) + '</b></p>' +
            '<p>Our agent <b>' + h_(oName) + '</b>' + (oPhone ? ' (' + h_(oPhone) + ')' : '') +
            ' will contact you soon.</p><p>Thank you,<br>' + APP.NAME + '</p>';
        MailApp.sendEmail({ to: l.email, subject: APP.NAME + (si ? ' — ඔබගේ ඉල්ලීම ලැබුණා (' : ' — request received (') + l.lead_id + ')',
          htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#122;max-width:520px">' + body + '</div>', name: APP.NAME });
      }
    } catch (e) { Logger.log('lead confirm email: ' + e.message); }
  }
  sendLeadWhatsApp_(l, oName);
}

/**
 * Optional automatic WhatsApp confirmation through the Meta WhatsApp Cloud API.
 * Works only when these Script properties are set (Project Settings → Script properties):
 *   WA_TOKEN, WA_PHONE_ID, WA_LEAD_TEMPLATE (an approved template with 3 body variables:
 *   {{1}} customer name, {{2}} reference number, {{3}} agent name), WA_LANG (default en_US).
 * Without them nothing is sent — the customer still gets the WhatsApp button on the thank-you page.
 */
function sendLeadWhatsApp_(l, agentName) {
  try {
    const pr = PropertiesService.getScriptProperties();
    const token = pr.getProperty('WA_TOKEN'), phoneId = pr.getProperty('WA_PHONE_ID'), tmpl = pr.getProperty('WA_LEAD_TEMPLATE');
    if (!token || !phoneId || !tmpl) return false;
    const to = '94' + String(l.phone).replace(/^0/, '');
    const res = UrlFetchApp.fetch('https:/' + '/graph.facebook.com/v21.0/' + phoneId + '/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        messaging_product: 'whatsapp', to: to, type: 'template',
        template: { name: tmpl, language: { code: pr.getProperty('WA_LANG') || 'en_US' },
          components: [{ type: 'body', parameters: [
            { type: 'text', text: String(l.name) }, { type: 'text', text: String(l.lead_id) }, { type: 'text', text: String(agentName) }] }] }
      })
    });
    if (res.getResponseCode() >= 300) Logger.log('WA lead send failed: ' + res.getContentText());
    return res.getResponseCode() < 300;
  } catch (e) { Logger.log('sendLeadWhatsApp_: ' + e.message); return false; }
}

// ---------- Officers: leads inside the app ----------
function openLeadsFor_(user) {
  if (!APP.LEADS_ENABLED) return [];
  let all;
  try { all = readAll_('LEADS'); } catch (e) { return []; }   // LEADS sheet not created yet (run setup)
  const me = user.username.toLowerCase();
  return all.filter(function (l) {
    const open = l.status === LEAD_STATUS.NEW || l.status === LEAD_STATUS.CONTACTED;
    return open && (isAdmin_(user) || String(l.assigned_to).toLowerCase() === me);
  });
}

function canSeeLead_(l, user) {
  return isAdmin_(user) || String(l.assigned_to).toLowerCase() === user.username.toLowerCase();
}

function leadView_(l, officers) {
  const o = {};
  SCHEMA.LEADS.forEach(function (c) { o[c] = l[c] instanceof Date ? Utilities.formatDate(l[c], APP.TZ, "yyyy-MM-dd'T'HH:mm") : l[c]; });
  delete o.photos_url;
  o.phone = normPhone_(l.phone);
  const a = officers[String(l.assigned_to).toLowerCase()];
  o.assigned_name = a ? a.name : '';
  o.summary = leadText_(l);
  o.age_hours = l.created_at instanceof Date ? Math.floor((Date.now() - l.created_at.getTime()) / 3600000) : '';
  return o;
}

function listLeads_(p, user) {
  const officers = officersMap_();
  const st = str_(p.status) || 'open';
  const rows = readAll_('LEADS').filter(function (l) {
    if (!canSeeLead_(l, user)) return false;
    if (st === 'open') return l.status === LEAD_STATUS.NEW || l.status === LEAD_STATUS.CONTACTED;
    return st === 'all' || l.status === st;
  }).sort(function (a, b) { return String(b.lead_id).localeCompare(String(a.lead_id)); });
  return {
    leads: rows.map(function (l) { return leadView_(l, officers); }),
    officers: isAdmin_(user) ? readAll_('USERS').filter(function (u) { return isTrue_(u.active); })
      .map(function (u) { return { username: String(u.username), name: String(u.full_name || u.username) }; }) : []
  };
}

/** Mark contacted / reject / reopen, or (admin) reassign. */
function updateLead_(p, user) {
  const l = findById_('LEADS', 'lead_id', p.leadId);
  if (!l) throw new Error('Request not found');
  if (!canSeeLead_(l, user)) throw new Error('This request is assigned to another officer');
  if (p.assignTo !== undefined) {
    if (!isAdmin_(user)) throw new Error('Only admins can reassign requests');
    const o = officersMap_()[str_(p.assignTo).toLowerCase()];
    if (!o) throw new Error('Officer not found');
    l.assigned_to = o.username;
    notifyLeadOfficer_(l, o);
  }
  if (p.status) {
    if ([LEAD_STATUS.NEW, LEAD_STATUS.CONTACTED, LEAD_STATUS.REJECTED].indexOf(p.status) === -1) throw new Error('Invalid status');
    if (l.status === LEAD_STATUS.CONVERTED) throw new Error('This request is already converted');
    l.status = p.status;
    if (p.status === LEAD_STATUS.REJECTED) l.reject_reason = str_(p.reason);
  }
  l.updated_at = new Date(); l.handled_by = user.username;
  writeRow_(sheet_('LEADS'), 'LEADS', l._row, l);
  return { ok: true, lead: leadView_(l, officersMap_()) };
}

/** The customer's photos (seller requests) as data URLs, for the officer only. */
function leadPhotos_(p, user) {
  const l = findById_('LEADS', 'lead_id', p.leadId);
  if (!l || !canSeeLead_(l, user)) throw new Error('Request not found');
  const m = String(l.photos_url || '').match(/folders\/([\w-]+)/);
  if (!m) return { photos: [] };
  const out = [];
  try {
    const it = DriveApp.getFolderById(m[1]).getFiles();
    while (it.hasNext() && out.length < APP.LEAD_MAX_PHOTOS) {
      const f = it.next();
      if (f.isTrashed && f.isTrashed()) continue;
      const b = f.getBlob();
      out.push('data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()));
    }
  } catch (e) {}
  return { photos: out };
}

/** Called when a Buyer / Vehicle is saved from a request. Moves seller photos to the vehicle. */
function convertLead_(leadId, recordId, user) {
  const l = findById_('LEADS', 'lead_id', leadId);
  if (!l || !canSeeLead_(l, user) || l.status === LEAD_STATUS.CONVERTED) return;
  l.status = LEAD_STATUS.CONVERTED; l.converted_id = recordId;
  l.updated_at = new Date(); l.handled_by = user.username;
  const m = String(l.photos_url || '').match(/folders\/([\w-]+)/);
  if (m && String(recordId).charAt(0) === 'V') {
    try {
      const v = findById_('VEHICLES', 'vehicle_id', recordId);
      const folder = DriveApp.getFolderById(m[1]);
      if (v && !v.photos_url) {
        folder.moveTo(photosRoot_());
        folder.setName(recordId + ' - ' + [v.make, v.model, v.year].filter(String).join(' '));
        v.photos_url = folder.getUrl();
        v.photo_count = Number(l.photo_count) || 0;
        writeRow_(sheet_('VEHICLES'), 'VEHICLES', v._row, v);
      }
    } catch (e) { Logger.log('convertLead_ photos: ' + e.message); }
  }
  writeRow_(sheet_('LEADS'), 'LEADS', l._row, l);
}


// ============================================================
//  PUBLIC SHOWROOM + WANTED BOARD  (vehicles.html — no login)
//  Only: approved, available vehicles ticked "Show on website";
//  active buyers not hidden from the Wanted board.
//  Never returns names, phone numbers, notes or officers.
// ============================================================
function isPublicVehicle_(v) {
  return String(v.show_public) === 'Yes' && isVehicleAvailable_(v);
}
function isWantedBuyer_(b) {
  return String(b.show_wanted) !== 'No' && isBuyerActive_(b);
}
function dayOf_(d) { return d instanceof Date ? Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd') : String(d || '').slice(0, 10); }

function publicContact_() {
  let phone = normPhone_(APP.PUBLIC_PHONE);
  if (!phone) {
    const a = readAll_('USERS').find(function (u) { return String(u.role) === 'admin' && isTrue_(u.active) && normPhone_(u.phone); });
    phone = a ? normPhone_(a.phone) : '';
  }
  return { phone: phone, facebook: 'https:/' + '/www.facebook.com/profile.php?id=61593573333056' };
}

/** PUBLIC: everything the showroom needs in one call (cached for 2 minutes). */
function publicListings() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('PUBLIC_LISTINGS');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  const vehicles = readAll_('VEHICLES').filter(isPublicVehicle_).map(function (v) {
    return {
      id: String(v.vehicle_id), type: String(v.vehicle_type || ''), make: String(v.make || ''), model: String(v.model || ''),
      year: v.year === '' ? '' : Number(v.year), price: v.price === '' ? '' : Number(v.price),
      condition: String(v.condition || ''), color: String(v.color || ''),
      photos: Number(v.photo_count) || 0, date: dayOf_(v.approved_at || v.created_at)
    };
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

  const wanted = readAll_('BUYERS').filter(isWantedBuyer_).map(function (b) {
    return {
      id: String(b.buyer_id), type: String(b.vehicle_type || ''), make: String(b.make || ''), model: String(b.model || ''),
      year_from: b.year_from === '' ? '' : Number(b.year_from), year_to: b.year_to === '' ? '' : Number(b.year_to),
      min_budget: b.min_budget === '' ? '' : Number(b.min_budget), max_budget: b.max_budget === '' ? '' : Number(b.max_budget),
      date: dayOf_(b.created_at)
    };
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

  const out = { vehicles: vehicles, wanted: wanted, contact: publicContact_(), types: DEFAULT_LISTS.VEHICLE_TYPE };
  try { const s = JSON.stringify(out); if (s.length < 90000) cache.put('PUBLIC_LISTINGS', s, 120); } catch (e) {}
  return out;
}

/** PUBLIC: cover thumbnails for public vehicles only. */
function publicThumbs(ids) {
  ids = (Array.isArray(ids) ? ids : []).slice(0, 24).map(String);
  const vMap = mapBy_(readAll_('VEHICLES'), 'vehicle_id');
  const out = {};
  ids.forEach(function (id) {
    const v = vMap[id];
    if (!v || !isPublicVehicle_(v) || !Number(v.photo_count)) return;
    let blob = null;
    if (fileAlive_(v.thumb_id)) { try { blob = DriveApp.getFileById(String(v.thumb_id)).getBlob(); } catch (e) {} }
    if (!blob) blob = makeThumbFromDrive_(v);
    if (blob) out[id] = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  });
  return out;
}

function publicFolder_(vehicleId) {
  const v = findById_('VEHICLES', 'vehicle_id', vehicleId);
  if (!v || !isPublicVehicle_(v)) throw new Error('This vehicle is no longer available');
  const m = String(v.photos_url || '').match(/folders\/([\w-]+)/);
  if (!m) return null;
  try { return DriveApp.getFolderById(m[1]); } catch (e) { return null; }
}

/** PUBLIC: photo ids of a public vehicle (max 10). */
function publicPhotos(vehicleId) {
  const folder = publicFolder_(vehicleId);
  const out = [];
  if (folder) {
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (!f.isTrashed || !f.isTrashed()) out.push({ id: f.getId(), name: f.getName() });
    }
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return out.slice(0, 10).map(function (x) { return x.id; });
}

/** PUBLIC: one photo of a public vehicle — must be inside that vehicle's folder. */
function publicPhoto(vehicleId, fileId) {
  const folder = publicFolder_(vehicleId);
  if (!folder) throw new Error('Photo not found');
  const f = DriveApp.getFileById(String(fileId));
  const parents = f.getParents();
  let ok = false;
  while (parents.hasNext()) { if (parents.next().getId() === folder.getId()) ok = true; }
  if (!ok || (f.isTrashed && f.isTrashed())) throw new Error('Photo not found');
  const blob = f.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

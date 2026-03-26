// ═══════════════════════════════════════════════════════════════
// JIA TRAINER CENTER — Google Apps Script Backend API
// v2: ใช้ Username/Password แทน Google Login
// วาง Code นี้ใน Google Apps Script Editor
// ═══════════════════════════════════════════════════════════════

// ─── CONFIG ──────────────────────────────────────────────────
const ADMIN_EMAIL = 'jiacpr@gmail.com'; // ใช้สำหรับส่ง email แจ้งเตือน

// ชื่อ Sheet ทั้งหมด
const SHEET = {
  users:              'users',
  invite_codes:       'invite_codes',
  customers:          'customers',
  bookings:           'bookings',
  sessions:           'sessions',
  courses:            'courses',
  staff:              'staff',
  instructors:        'instructors',
  instructor_avail:   'instructor_avail',
  instructor_quals:   'instructor_quals',
  promo_codes:        'promo_codes',
  settings:           'settings',
  pdpa_log:           'pdpa_log',
  // ═══ v2: Flow ใหม่ ═══
  classes:            'classes',            // คลาสเรียนที่ Admin เปิด
  class_instructors:  'class_instructors',  // ผู้สอนที่รับสอนแต่ละคลาส
};

// Headers ของแต่ละ Sheet — users เปลี่ยนเป็น username/password
const HEADERS = {
  users:            ['username','name','role','password','registeredAt','lastLogin'],
  invite_codes:     ['code','role','createdBy','createdAt','usedBy','usedAt','status','level'],
  customers:        ['id','name','tel','email','createdAt','source'],
  bookings:         ['id','customerId','name','tel','courseType','courseName','classId','channel','package','totalPeople','finalPrice','discountCode','discountAmount','paymentMode','paymentSlip','paymentStatus','startDate','timeSlot','totalDays','additionalDates','salesStaff','instructor','note','pdpaConsent','pdpaConsentDate','createdAt'],
  sessions:         ['id','bookingId','customerId','sessionNo','done','date','sessionTime','place','createdAt'],
  courses:          ['key','label','range','max','color','price','discountPrice','onlineBooking','hasPackages','flexPrice','fixedPrice','description','timeSlots','durationHours','totalDays','requiredLevel'],
  staff:            ['id','name'],
  instructors:      ['id','name','level'],   // level: 1=Basic, 2=Intermediate, 3=Advanced
  instructor_avail: ['id','instructor','date','timeSlot'],
  instructor_quals: ['instructor','courses'],
  promo_codes:      ['code','type','discount','staffName','createdAt','used','usedAt','usedBy'],
  settings:         ['key','value'],
  pdpa_log:         ['id','customerId','action','performedBy','date','details'],
  // ═══ v2: Flow ใหม่ ═══
  classes:          ['id','courseKey','courseName','date','timeSlot','maxStudents','requiredInstructors','currentInstructors','status','place','note','createdBy','createdAt'],
  // status: waiting_instructor | ready | full | completed | cancelled
  class_instructors: ['id','classId','instructor','assignedBy','assignedAt']
};

// ─── SHA-256 HELPER ─────────────────────────────────────────
function sha256(input) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return rawHash.map(function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
}

// ─── ENTRY POINTS ────────────────────────────────────────────

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const p = e.parameter;
    const action = p.action || '';
    const callback = p.callback || ''; // JSONP support

    // รับ body จาก POST (JSON/form) หรือ GET parameter 'data' (base64)
    function getBody() {
      // 1. ลอง JSON body จาก POST ก่อน
      if (e.postData && e.postData.contents) {
        try { return JSON.parse(e.postData.contents); } catch(je) {}
      }
      // 2. ลอง parameter 'data' (base64 encoded หรือ JSON ตรง)
      if (p.data) {
        try {
          var decoded = Utilities.newBlob(Utilities.base64Decode(p.data)).getDataAsString();
          return JSON.parse(decoded);
        } catch(decErr) {
          try { return JSON.parse(p.data); } catch(je2) {}
        }
      }
      return {};
    }

    // JSONP wrapper — ถ้ามี callback parameter จะส่งเป็น JavaScript แทน JSON
    function respond(data) {
      if (callback) {
        return ContentService
          .createTextOutput(callback + '(' + JSON.stringify(data) + ')')
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ok(data);
    }

    switch (action) {
      // ── Auth (ระบบใหม่ — username/password) ──
      case 'loginPassword':
        return respond(loginPassword(p.username, p.password));
      case 'registerPassword':
        return respond(registerPassword(p.code, p.username, p.name, p.password));
      case 'checkUsername':
        return respond(checkUsername(p.username));
      case 'listUsers':
        return respond(listUsers());
      case 'resetPassword':
        return respond(resetPassword(p.adminUser, p.targetUser, p.newPassword));

      // ── Auth (ระบบเก่า — เก็บไว้ backward compat) ──
      case 'login':
        return respond(loginUser(p.email, p.name, p.photo));
      case 'register':
        return respond(registerUser(p.email, p.name, p.photo, p.code));
      case 'checkUser':
        return respond(checkUser(p.email));

      // ── Invite Codes ──
      case 'genCode':
        return respond(generateInviteCode(p.role, p.username || p.email, p.level));
      case 'listCodes':
        return respond(getSheetData(SHEET.invite_codes));

      // ── Data CRUD (with authorization) ──
      case 'getData': {
        // Whitelist: only allow known sheet names
        var allowedSheets = Object.values(SHEET);
        if (!p.sheet || allowedSheets.indexOf(p.sheet) === -1) {
          return respond({ error: 'Invalid sheet name: ' + p.sheet });
        }
        // Block sensitive sheets without auth
        var sensitiveSheets = [SHEET.users, SHEET.invite_codes];
        if (sensitiveSheets.indexOf(p.sheet) !== -1) {
          var authUser = _requireRole(p.username || p.email, ['admin']);
          if (authUser && authUser.error) return respond(authUser);
        }
        return respond(getSheetData(p.sheet));
      }
      case 'getAllData':
        return respond(getAllData(p.username || p.email));
      case 'saveRow':
        return respond(saveRow(p.sheet, getBody()));
      case 'updateRow':
        return respond(updateRow(p.sheet, p.key, p.keyCol, getBody()));
      case 'deleteRow': {
        var authDel = _requireRole(p.username || p.email, ['admin']);
        if (authDel && authDel.error) return respond(authDel);
        return respond(deleteRow(p.sheet, p.key, p.keyCol));
      }
      case 'replaceSheet': {
        var authRepl = _requireRole(p.username || p.email, ['admin', 'sales', 'instructor']);
        if (authRepl && authRepl.error) return respond(authRepl);
        return respond(replaceSheetData(p.sheet, getBody()));
      }
      case 'saveAll': {
        var authSaveAll = _requireRole(p.username || p.email, ['admin']);
        if (authSaveAll && authSaveAll.error) return respond(authSaveAll);
        return respond(saveAllData(getBody()));
      }
      case 'clearSheet': {
        var authClear = _requireRole(p.username || p.email, ['admin']);
        if (authClear && authClear.error) return respond(authClear);
        return respond(clearSheetData(p.sheet));
      }
      case 'appendRows':
        return respond(appendRows(p.sheet, getBody()));

      // ── Instructor auto-register ──
      case 'ensureInstructor':
        return respond(ensureInstructor(p.name, p.username));

      // ── v2: Class Management ──
      case 'acceptClass':
        return respond(acceptClass(p.classId, p.instructor, p.assignedBy));

      case 'notifyBooking':
        return respond(notifyNewBooking(getBody()));
      case 'notifyPayment':
        return respond(notifyPaymentConfirmed(getBody()));
      case 'createCalendarEvent':
        return respond(createBookingCalendarEvent(getBody()));

      // ── File Upload ──
      case 'uploadSlip':
        return respond(uploadSlip(getBody()));

      // ── Setup ──
      case 'init':
        return respond(initializeSheets());

      default:
        return respond({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    // ใช้ respond ไม่ได้ในบาง case ที่ error ก่อน define
    var cb = (e.parameter || {}).callback || '';
    var errData = { error: err.message, stack: err.stack };
    if (cb) {
      return ContentService.createTextOutput(cb + '(' + JSON.stringify(errData) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ok(errData);
  }
}

// ─── RESPONSE HELPER ─────────────────────────────────────────

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── AUTHORIZATION HELPER ────────────────────────────────────
// ตรวจสอบว่า user มี role ที่ต้องการ
function _requireRole(identifier, allowedRoles) {
  if (!identifier) return { error: 'unauthorized', message: 'ไม่ได้ระบุผู้ใช้' };
  var users = getSheetData(SHEET.users);
  var user = users.find(function(u) { return u.username === identifier || u.email === identifier; });
  if (!user) return { error: 'unauthorized', message: 'ไม่พบผู้ใช้' };
  if (allowedRoles.indexOf(user.role) === -1) {
    return { error: 'forbidden', message: 'ไม่มีสิทธิ์ (ต้องเป็น ' + allowedRoles.join(' หรือ ') + ')' };
  }
  return null; // authorized
}

// ─── INITIALIZATION ──────────────────────────────────────────
// รันครั้งเดียวเพื่อสร้าง Sheet ทั้งหมด

function initializeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const created = [];

  Object.keys(HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created.push(name);
    }
    // Set headers if row 1 is empty
    const firstCell = sheet.getRange(1, 1).getValue();
    if (!firstCell) {
      sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
      sheet.getRange(1, 1, 1, HEADERS[name].length)
        .setFontWeight('bold')
        .setBackground('#4285f4')
        .setFontColor('white');
      sheet.setFrozenRows(1);
    }
  });

  // Auto-create admin user (username: admin, password: 1234)
  const usersSheet = ss.getSheetByName(SHEET.users);
  const usersData = getSheetData(SHEET.users);
  const adminExists = usersData.some(u => u.username === 'admin');
  if (!adminExists) {
    const defaultPassword = sha256('1234');
    const headers = HEADERS.users;
    const row = headers.map(h => {
      if (h === 'username') return 'admin';
      if (h === 'name') return 'Admin (Jia)';
      if (h === 'role') return 'admin';
      if (h === 'password') return defaultPassword;
      if (h === 'registeredAt') return new Date().toISOString();
      return '';
    });
    usersSheet.appendRow(row);
    created.push('admin user: admin (password: 1234)');
  }

  // Create default courses if empty
  const coursesData = getSheetData(SHEET.courses);
  if (coursesData.length === 0) {
    const defaults = [
      { key:'BLS', label:'BLS', range:'1-30', max:30, color:'#3B82F6', price:500, discountPrice:400, onlineBooking:true, hasPackages:false, flexPrice:600, fixedPrice:500, description:'Basic Life Support', timeSlots:'["09:00-11:00","13:00-15:00"]', durationHours:2, totalDays:1 },
      { key:'ACLS', label:'ACLS', range:'1-30', max:30, color:'#EF4444', price:600, discountPrice:500, onlineBooking:true, hasPackages:false, flexPrice:700, fixedPrice:600, description:'Advanced Cardiovascular Life Support', timeSlots:'["09:00-12:00","13:00-16:00"]', durationHours:3, totalDays:2 },
      { key:'CPR', label:'CPR/AED', range:'1-30', max:30, color:'#10B981', price:400, discountPrice:300, onlineBooking:true, hasPackages:true, flexPrice:500, fixedPrice:400, description:'CPR และ AED', timeSlots:'["09:00-11:00","13:00-15:00","17:00-19:00"]', durationHours:2, totalDays:1 }
    ];
    const courseSheet = ss.getSheetByName(SHEET.courses);
    const headers = HEADERS.courses;
    defaults.forEach(c => {
      courseSheet.appendRow(headers.map(h => c[h] !== undefined ? c[h] : ''));
    });
  }

  // ไม่ใส่ default instructors — เพิ่มเองในตั้งค่า

  // Delete default "Sheet1" if exists
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  return { success: true, created };
}

// ─── AUTH FUNCTIONS (ระบบใหม่ — username/password) ────────────

function loginPassword(username, passwordHash) {
  if (!username || !passwordHash) return { error: 'missing_fields', message: 'กรุณากรอก username และรหัสผ่าน' };

  const users = getSheetData(SHEET.users);
  const user = users.find(u => u.username === username);
  if (!user) return { error: 'not_found', message: 'ไม่พบผู้ใช้นี้' };
  if (user.password !== passwordHash) return { error: 'wrong_password', message: 'รหัสผ่านไม่ถูกต้อง' };

  // Update last login
  updateRow(SHEET.users, username, 'username', {
    username: username,
    name: user.name,
    role: user.role,
    password: user.password,
    registeredAt: user.registeredAt,
    lastLogin: new Date().toISOString()
  });

  return { success: true, role: user.role, name: user.name, username: username };
}

function registerPassword(code, username, name, passwordHash) {
  if (!code || !username || !name || !passwordHash) return { error: 'missing_fields', message: 'กรุณากรอกข้อมูลให้ครบ' };

  // Validate username format
  if (username.length < 3) return { error: 'invalid_username', message: 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร' };

  // Check if username already exists
  const users = getSheetData(SHEET.users);
  if (users.find(u => u.username === username)) {
    return { error: 'already_exists', message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' };
  }

  // Verify invite code
  const codes = getSheetData(SHEET.invite_codes);
  const codeObj = codes.find(c => c.code === code && c.status === 'active');
  if (!codeObj) {
    return { error: 'invalid_code', message: 'รหัสเชิญไม่ถูกต้องหรือถูกใช้แล้ว' };
  }

  // Register user
  const now = new Date().toISOString();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = getOrCreateSheet(SHEET.users);
  usersSheet.appendRow([username, name, codeObj.role, passwordHash, now, now]);

  // Mark code as used
  updateRow(SHEET.invite_codes, code, 'code', {
    code: code,
    role: codeObj.role,
    createdBy: codeObj.createdBy,
    createdAt: codeObj.createdAt,
    usedBy: username,
    usedAt: now,
    status: 'used',
    level: codeObj.level || ''
  });

  // ถ้า role เป็น instructor → เพิ่มเข้า instructors sheet อัตโนมัติ
  if (codeObj.role === 'instructor') {
    var instructors = getSheetData(SHEET.instructors);
    var alreadyExists = instructors.find(function(i) { return i.name === name; });
    if (!alreadyExists) {
      saveRow(SHEET.instructors, { id: 'inst_' + new Date().getTime(), name: name, level: parseInt(codeObj.level) || 1 });
    }
  }

  return { success: true, role: codeObj.role, name: name, username: username };
}

function checkUsername(username) {
  if (!username) return { registered: false };
  const users = getSheetData(SHEET.users);
  const user = users.find(u => u.username === username);
  if (user) {
    return { registered: true, role: user.role, name: user.name };
  }
  return { registered: false };
}

function listUsers() {
  const users = getSheetData(SHEET.users);
  // ส่งกลับโดยไม่มี password hash
  return users.map(u => ({
    username: u.username,
    name: u.name,
    role: u.role,
    registeredAt: u.registeredAt,
    lastLogin: u.lastLogin
  }));
}

function resetPassword(adminUser, targetUser, newPasswordHash) {
  if (!adminUser || !targetUser || !newPasswordHash) return { error: 'ข้อมูลไม่ครบ' };
  var users = getSheetData(SHEET.users);
  // ตรวจสอบว่าคนที่สั่งเป็น admin จริง
  var admin = users.find(function(u) { return u.username === adminUser; });
  if (!admin || admin.role !== 'admin') return { error: 'ไม่มีสิทธิ์ (ต้องเป็น admin)' };
  // หา user ที่ต้องการรีเซ็ต
  var target = users.find(function(u) { return u.username === targetUser; });
  if (!target) return { error: 'ไม่พบผู้ใช้ ' + targetUser };
  // อัปเดต password ในชีท
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET.users);
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var userCol = headers.indexOf('username');
  var passCol = headers.indexOf('password');
  for (var i = 1; i < data.length; i++) {
    if (data[i][userCol] === targetUser) {
      sh.getRange(i + 1, passCol + 1).setValue(newPasswordHash);
      return { success: true, message: 'รีเซ็ตรหัสผ่านสำเร็จ' };
    }
  }
  return { error: 'ไม่พบผู้ใช้ในชีท' };
}

// ─── AUTH FUNCTIONS (ระบบเก่า — backward compat) ─────────────

function checkUser(email) {
  if (!email) return { registered: false };
  const users = getSheetData(SHEET.users);
  // ลองหาทั้ง username และ email (backward compat)
  const user = users.find(u => u.username === email || u.email === email);
  if (user) {
    return { registered: true, role: user.role, name: user.name };
  }
  return { registered: false };
}

function loginUser(email, name, photo) {
  if (!email) return { error: 'Email required' };
  const users = getSheetData(SHEET.users);
  const user = users.find(u => u.username === email || u.email === email);
  if (!user) {
    return { error: 'not_registered', message: 'ยังไม่ได้ลงทะเบียน' };
  }
  return { success: true, role: user.role, name: user.name, email: email };
}

function registerUser(email, name, photo, code) {
  if (!email || !code) return { error: 'Email and invite code required' };
  const users = getSheetData(SHEET.users);
  if (users.find(u => u.username === email || u.email === email)) {
    return { error: 'already_registered', message: 'ลงทะเบียนแล้ว' };
  }
  const codes = getSheetData(SHEET.invite_codes);
  const codeObj = codes.find(c => c.code === code && c.status === 'active');
  if (!codeObj) {
    return { error: 'invalid_code', message: 'รหัสเชิญไม่ถูกต้องหรือถูกใช้แล้ว' };
  }
  const now = new Date().toISOString();
  const usersSheet = getOrCreateSheet(SHEET.users);
  // ใส่ในรูปแบบ users ใหม่: username, name, role, password(ว่าง), registeredAt, lastLogin
  usersSheet.appendRow([email, name, codeObj.role, '', now, now]);
  updateRow(SHEET.invite_codes, code, 'code', {
    code: code, role: codeObj.role, createdBy: codeObj.createdBy,
    createdAt: codeObj.createdAt, usedBy: email, usedAt: now, status: 'used',
    level: codeObj.level || ''
  });

  // ถ้า role เป็น instructor → เพิ่มเข้า instructors sheet อัตโนมัติ
  if (codeObj.role === 'instructor') {
    var instructors = getSheetData(SHEET.instructors);
    var alreadyExists = instructors.find(function(i) { return i.name === name; });
    if (!alreadyExists) {
      saveRow(SHEET.instructors, { id: 'inst_' + new Date().getTime(), name: name, level: parseInt(codeObj.level) || 1 });
    }
  }

  return { success: true, role: codeObj.role, name: name, email: email };
}

// ─── ENSURE INSTRUCTOR EXISTS ────────────────────────────────

function ensureInstructor(name, username) {
  if (!name) return { error: 'missing_name' };

  // ตรวจว่า user เป็น instructor จริง
  if (username) {
    var users = getSheetData(SHEET.users);
    var user = users.find(function(u) { return u.username === username; });
    if (!user || user.role !== 'instructor') {
      return { error: 'not_instructor', message: 'ไม่ใช่ผู้สอน' };
    }
  }

  var instructors = getSheetData(SHEET.instructors);
  // เปรียบเทียบชื่อแบบ trim + case-insensitive เพื่อป้องกัน duplicate
  var nameTrimmed = name.trim();
  var existing = instructors.find(function(i) {
    return i.name && i.name.trim().toLowerCase() === nameTrimmed.toLowerCase();
  });

  if (existing) {
    return { success: true, action: 'already_exists', instructor: existing };
  }

  // ยังไม่มี → เพิ่มอัตโนมัติ
  var newInst = { id: 'inst_' + new Date().getTime(), name: name, level: 1 };
  saveRow(SHEET.instructors, newInst);

  return { success: true, action: 'created', instructor: newInst };
}

// ─── INVITE CODE GENERATION ─────────────────────────────────

function generateInviteCode(role, creator, level) {
  if (!role || !creator) return { error: 'Role and creator required' };

  // Verify creator is admin
  const users = getSheetData(SHEET.users);
  const creatorUser = users.find(u => u.username === creator || u.email === creator);
  if (!creatorUser || creatorUser.role !== 'admin') {
    return { error: 'unauthorized', message: 'เฉพาะแอดมินเท่านั้น' };
  }

  const validRoles = ['admin', 'sales', 'instructor'];
  if (!validRoles.includes(role)) {
    return { error: 'invalid_role', message: 'Role ไม่ถูกต้อง' };
  }

  // Generate code: ROLE-XXXXXX
  const prefix = role === 'admin' ? 'ADM' : role === 'sales' ? 'SALE' : 'INST';
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const code = prefix + '-' + random;

  // Store level for instructor codes
  const instrLevel = (role === 'instructor' && level) ? parseInt(level) : '';

  const codesSheet = getOrCreateSheet(SHEET.invite_codes);
  codesSheet.appendRow([code, role, creator, new Date().toISOString(), '', '', 'active', instrLevel]);

  return { success: true, code: code, role: role, level: instrLevel };
}

// ─── DATA CRUD ───────────────────────────────────────────────

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // Only headers or empty

  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, j) => {
      let val = data[i][j];
      // Convert Date objects to YYYY-MM-DD string
      if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        val = y + '-' + m + '-' + d;
      }
      // Parse JSON arrays/objects stored as strings
      if (typeof val === 'string' && val.startsWith('[') || typeof val === 'string' && val.startsWith('{')) {
        try { val = JSON.parse(val); } catch (e) {}
      }
      // Convert "true"/"false" strings to booleans
      if (val === 'TRUE' || val === true) val = true;
      else if (val === 'FALSE' || val === false) val = false;
      obj[h] = val;
    });
    rows.push(obj);
  }
  return rows;
}

function getAllData(identifier) {
  // identifier = username (ระบบใหม่) หรือ email (ระบบเก่า)
  const users = getSheetData(SHEET.users);
  const user = users.find(u => u.username === identifier || u.email === identifier);
  if (!user) return { error: 'not_registered' };

  const result = { role: user.role };

  if (user.role === 'admin' || user.role === 'sales') {
    // Admin + Sales gets everything needed
    result.customers = getSheetData(SHEET.customers);
    result.bookings = getSheetData(SHEET.bookings);
    result.sessions = getSheetData(SHEET.sessions);
    result.courses = getSheetData(SHEET.courses);
    result.staff = getSheetData(SHEET.staff);
    result.instructors = getSheetData(SHEET.instructors);
    result.instructor_avail = getSheetData(SHEET.instructor_avail);
    result.instructor_quals = getSheetData(SHEET.instructor_quals);
    result.promo_codes = getSheetData(SHEET.promo_codes);
    result.settings = getSheetData(SHEET.settings);
    result.pdpa_log = getSheetData(SHEET.pdpa_log);
    // v2: คลาสและผู้สอนที่รับสอน
    result.classes = getSheetData(SHEET.classes);
    result.class_instructors = getSheetData(SHEET.class_instructors);
    if (user.role === 'admin') {
      result.users = getSheetData(SHEET.users);
      result.invite_codes = getSheetData(SHEET.invite_codes);
    }
  } else if (user.role === 'instructor') {
    // Instructor gets classes they can teach + their assignments
    result.courses = getSheetData(SHEET.courses);
    result.instructors = getSheetData(SHEET.instructors);
    result.classes = getSheetData(SHEET.classes);
    result.class_instructors = getSheetData(SHEET.class_instructors);
    result.bookings = getSheetData(SHEET.bookings).filter(b => b.instructor === user.name);
    result.sessions = getSheetData(SHEET.sessions);
    result.instructor_avail = getSheetData(SHEET.instructor_avail).filter(a => a.instructor === user.name);
    result.instructor_quals = getSheetData(SHEET.instructor_quals);
  }

  return result;
}

function saveRow(sheetName, rowData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found: ' + sheetName };

  const headers = HEADERS[sheetName];
  if (!headers) return { error: 'Unknown sheet: ' + sheetName };

  const row = headers.map(h => {
    const val = rowData[h];
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return val;
  });

  sheet.appendRow(row);
  return { success: true };
}

function updateRow(sheetName, keyValue, keyCol, rowData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found' };

  const headers = HEADERS[sheetName];
  const keyIndex = headers.indexOf(keyCol);
  if (keyIndex < 0) return { error: 'Key column not found: ' + keyCol };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIndex]) === String(keyValue)) {
      const newRow = headers.map((h, idx) => {
        // ถ้ามีค่าใน rowData → ใช้ค่าใหม่, ถ้าไม่มี → เก็บค่าเดิม (merge)
        if (h in rowData) {
          const val = rowData[h];
          if (val === undefined || val === null) return '';
          if (typeof val === 'object') return JSON.stringify(val);
          return val;
        }
        return data[i][idx]; // keep existing value
      });
      sheet.getRange(i + 1, 1, 1, newRow.length).setValues([newRow]);
      return { success: true, updated: i };
    }
  }
  return { error: 'Row not found with ' + keyCol + ' = ' + keyValue };
}

function deleteRow(sheetName, keyValue, keyCol) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found' };

  const headers = HEADERS[sheetName];
  const keyIndex = headers.indexOf(keyCol || 'id');
  if (keyIndex < 0) return { error: 'Key column not found' };

  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][keyIndex]) === String(keyValue)) {
      sheet.deleteRow(i + 1);
      return { success: true, deleted: i };
    }
  }
  return { error: 'Row not found' };
}

function replaceSheetData(sheetName, dataArray) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found' };

  const headers = HEADERS[sheetName];
  if (!headers) return { error: 'Unknown sheet' };

  // Clear all data except headers
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clear();
  }

  // Write new data
  if (dataArray.length > 0) {
    const rows = dataArray.map(rowData =>
      headers.map(h => {
        const val = rowData[h];
        if (val === undefined || val === null) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return val;
      })
    );
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { success: true, count: dataArray.length };
}

// สร้าง sheet อัตโนมัติถ้ายังไม่มี + ใส่ headers
function getOrCreateSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    var headers = HEADERS[sheetName];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sheet;
}

function clearSheetData(sheetName) {
  const sheet = getOrCreateSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clear();
  }
  return { success: true, cleared: sheetName };
}

function appendRows(sheetName, dataArray) {
  const sheet = getOrCreateSheet(sheetName);
  const headers = HEADERS[sheetName];
  if (!headers) return { error: 'Unknown sheet: ' + sheetName };
  if (!Array.isArray(dataArray) || dataArray.length === 0) return { success: true, count: 0 };

  const rows = dataArray.map(rowData =>
    headers.map(h => {
      const val = rowData[h];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return val;
    })
  );
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  return { success: true, count: rows.length };
}

// ─── SAVE ALL DATA (บันทึกทุก sheet ในรอบเดียว — ลด request จาก 10 เหลือ 1) ──────
function saveAllData(allData) {
  if (!allData || typeof allData !== 'object') return { error: 'Invalid data' };
  var results = {};
  var successCount = 0;
  var failCount = 0;

  // วนทุก sheet ที่ส่งมา
  for (var sheetName in allData) {
    if (!allData.hasOwnProperty(sheetName)) continue;
    if (!HEADERS[sheetName]) { results[sheetName] = { error: 'Unknown sheet' }; failCount++; continue; }

    var dataArray = allData[sheetName];
    if (!Array.isArray(dataArray)) { results[sheetName] = { error: 'Not array' }; failCount++; continue; }

    try {
      var sheet = getOrCreateSheet(sheetName);
      var headers = HEADERS[sheetName];

      // แปลงข้อมูลเป็น rows
      var rows = dataArray.map(function(rowData) {
        return headers.map(function(h) {
          var val = rowData[h];
          if (val === undefined || val === null) return '';
          if (typeof val === 'object') return JSON.stringify(val);
          return val;
        });
      });

      // อัพเดท headers ให้ตรงเสมอ
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

      // ลบข้อมูลเก่า
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clear();
      }

      // เขียนข้อมูลใหม่
      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }

      results[sheetName] = { success: true, count: dataArray.length };
      successCount++;
    } catch(e) {
      results[sheetName] = { error: e.message };
      failCount++;
    }
  }

  return { success: failCount === 0, results: results, saved: successCount, failed: failCount };
}

// ─── v2: ACCEPT CLASS (ผู้สอนรับสอนคลาส) ──────────────────────
function acceptClass(classId, instructorName, assignedBy) {
  if (!classId || !instructorName) return { error: 'Missing classId or instructor' };

  // 1. หาข้อมูลคลาส
  var classesSheet = getOrCreateSheet(SHEET.classes);
  var classHeaders = HEADERS[SHEET.classes];
  var classData = getSheetData(SHEET.classes);
  var classRow = classData.find(function(c) { return c.id === classId; });
  if (!classRow) return { error: 'Class not found: ' + classId };

  // 2. ตรวจสอบว่าคลาสยังรับผู้สอนอยู่
  if (classRow.status !== 'waiting_instructor' && classRow.status !== 'ready') {
    return { error: 'Class is not accepting instructors (status: ' + classRow.status + ')' };
  }

  // 3. ตรวจ Level ผู้สอน
  var instructorData = getSheetData(SHEET.instructors);
  var instructor = instructorData.find(function(i) { return i.name === instructorName; });
  if (!instructor) return { error: 'Instructor not found: ' + instructorName };

  var courseData = getSheetData(SHEET.courses);
  var course = courseData.find(function(c) { return c.key === classRow.courseKey; });
  if (course) {
    var requiredLevel = parseInt(course.requiredLevel) || 1;
    var instructorLevel = parseInt(instructor.level) || 1;
    if (instructorLevel < requiredLevel) {
      return { error: 'Instructor level ' + instructorLevel + ' is below required level ' + requiredLevel + ' for this course' };
    }
  }

  // 4. ตรวจว่าผู้สอนไม่ได้รับสอนคลาสนี้อยู่แล้ว
  var ciData = getSheetData(SHEET.class_instructors);
  var already = ciData.find(function(ci) { return ci.classId === classId && ci.instructor === instructorName; });
  if (already) return { error: 'Instructor already assigned to this class' };

  // 5. ตรวจเวลาไม่ชนกับคลาสอื่น
  var myClasses = ciData.filter(function(ci) { return ci.instructor === instructorName; });
  for (var i = 0; i < myClasses.length; i++) {
    var otherClass = classData.find(function(c) { return c.id === myClasses[i].classId; });
    if (otherClass && otherClass.date === classRow.date && otherClass.timeSlot === classRow.timeSlot) {
      return { error: 'Time conflict with class: ' + otherClass.courseName + ' on ' + otherClass.date };
    }
  }

  // 6. เพิ่มผู้สอนเข้าคลาส
  var newCi = {
    id: 'ci_' + new Date().getTime(),
    classId: classId,
    instructor: instructorName,
    assignedBy: assignedBy || instructorName,
    assignedAt: new Date().toISOString()
  };
  saveRow(SHEET.class_instructors, newCi);

  // 7. อัพเดทจำนวนผู้สอนปัจจุบัน + สถานะ (ดึงข้อมูลใหม่หลัง saveRow เพื่อไม่ใช้ stale data)
  var freshCiData = getSheetData(SHEET.class_instructors);
  var currentCount = freshCiData.filter(function(ci) { return ci.classId === classId; }).length;
  var requiredCount = parseInt(classRow.requiredInstructors) || 1;
  var newStatus = currentCount >= requiredCount ? 'ready' : 'waiting_instructor';

  // อัพเดท class row
  updateRow(SHEET.classes, classId, 'id', {
    currentInstructors: currentCount,
    status: newStatus
  });

  return {
    success: true,
    classId: classId,
    instructor: instructorName,
    currentInstructors: currentCount,
    requiredInstructors: requiredCount,
    status: newStatus
  };
}

// ─── REPLACE SHEET (atomic: ลบ+เขียนในครั้งเดียว ไม่หาย) ──────
function replaceSheet(sheetName, dataArray) {
  var sheet = getOrCreateSheet(sheetName);
  var headers = HEADERS[sheetName];
  if (!headers) return { error: 'Unknown sheet: ' + sheetName };
  if (!Array.isArray(dataArray)) return { error: 'Data must be array' };

  // แปลงข้อมูลเป็น rows
  var rows = dataArray.map(function(rowData) {
    return headers.map(function(h) {
      var val = rowData[h];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return val;
    });
  });

  // ลบข้อมูลเก่า
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clear();
  }

  // เขียนข้อมูลใหม่ทันที (ในรอบเดียว)
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { success: true, count: rows.length, sheet: sheetName };
}

// ─── FILE UPLOAD (Payment Slips) ─────────────────────────────

function uploadSlip(data) {
  try {
    const { base64, fileName, bookingId } = data;

    // Create folder if not exists
    let folder;
    const folders = DriveApp.getFoldersByName('JIA-Slips');
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder('JIA-Slips');
    }

    // Decode base64 and save to Drive
    const parts = base64.split(',');
    const mimeType = parts[0].match(/:(.*?);/)[1];
    const bytes = Utilities.base64Decode(parts[1]);
    const blob = Utilities.newBlob(bytes, mimeType, fileName || bookingId + '.jpg');

    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileUrl = 'https://drive.google.com/uc?id=' + file.getId();

    return { success: true, url: fileUrl, fileId: file.getId() };
  } catch (err) {
    return { error: 'Upload failed: ' + err.message };
  }
}

// ─── BOOKING NOTIFICATION ─────────────────────────────────────

function notifyNewBooking(bookingData) {
  try {
    const name = bookingData.name || 'ไม่ระบุ';
    const course = bookingData.courseType || bookingData.courseName || 'ไม่ระบุ';
    const tel = bookingData.tel || '-';
    const date = bookingData.startDate || '-';
    const timeSlot = bookingData.timeSlot || '-';
    const channel = bookingData.channel || '-';
    const sales = bookingData.salesStaff || '-';
    const instructor = bookingData.instructor || '-';
    const price = bookingData.finalPrice || '-';
    const people = bookingData.totalPeople || 1;

    const subject = 'จองใหม่! ' + name + ' — ' + course;
    const body = [
      '=== การจองใหม่ ===',
      '',
      'ชื่อ: ' + name,
      'โทร: ' + tel,
      'คอร์ส: ' + course,
      'วันที่: ' + date,
      'เวลา: ' + timeSlot,
      'จำนวน: ' + people + ' คน',
      'ราคา: ' + price + ' บาท',
      'ช่องทาง: ' + channel,
      'เซลล์: ' + sales,
      'ผู้สอน: ' + instructor,
      '',
      'ส่งจาก JIA Trainer Center'
    ].join('\n');

    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: subject,
      body: body
    });

    return { success: true, notified: ADMIN_EMAIL };
  } catch (err) {
    return { error: 'Notification failed: ' + err.message };
  }
}

// ─── PAYMENT CONFIRMED NOTIFICATION ──────────────────────────

function notifyPaymentConfirmed(data) {
  try {
    const name = data.name || 'ไม่ระบุ';
    const course = data.courseType || data.courseName || 'ไม่ระบุ';
    const tel = data.tel || '-';
    const date = data.startDate || '-';
    const timeSlot = data.timeSlot || '-';
    const price = data.finalPrice || '-';
    const bookingId = data.id || '-';

    const subject = 'ชำระเงินแล้ว! ' + name + ' — ' + course;
    const body = [
      '=== ยืนยันการชำระเงิน ===',
      '',
      'ชื่อ: ' + name,
      'โทร: ' + tel,
      'คอร์ส: ' + course,
      'วันที่เรียน: ' + date,
      'เวลา: ' + timeSlot,
      'ยอดชำระ: ' + price + ' บาท',
      'รหัสจอง: ' + bookingId,
      '',
      'สลิปตรวจสอบแล้ว — ชำระเรียบร้อย',
      '',
      'ส่งจาก JIA Trainer Center'
    ].join('\n');

    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: subject,
      body: body
    });

    return { success: true, notified: ADMIN_EMAIL };
  } catch (err) {
    return { error: 'Payment notification failed: ' + err.message };
  }
}

// ─── CREATE GOOGLE CALENDAR EVENT ────────────────────────────

function createBookingCalendarEvent(data) {
  try {
    const name = data.name || 'ไม่ระบุ';
    const course = data.courseType || data.courseName || 'ไม่ระบุ';
    const tel = data.tel || '-';
    const date = data.startDate;
    const timeSlot = data.timeSlot || '';
    const price = data.finalPrice || '-';
    const bookingId = data.id || '-';
    const totalDays = data.totalDays || 1;
    const additionalDates = data.additionalDates || [];

    if (!date) return { error: 'No date provided' };

    var startHour = 9, startMin = 0, endHour = 12, endMin = 0;
    if (timeSlot) {
      var parts = timeSlot.split(/[–\-]/);
      if (parts.length >= 2) {
        var s = parts[0].trim().split(':');
        var en = parts[1].trim().split(':');
        startHour = parseInt(s[0]) || 9;
        startMin = parseInt(s[1]) || 0;
        endHour = parseInt(en[0]) || 12;
        endMin = parseInt(en[1]) || 0;
      }
    }

    var allDates = [date].concat(additionalDates);
    var createdEvents = [];

    for (var i = 0; i < allDates.length; i++) {
      var d = allDates[i];
      if (!d) continue;

      var dateParts = d.split('-');
      var startTime = new Date(
        parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]),
        startHour, startMin
      );
      var endTime = new Date(
        parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]),
        endHour, endMin
      );

      var dayLabel = allDates.length > 1 ? ' (วันที่ ' + (i + 1) + '/' + allDates.length + ')' : '';
      var title = course + ' — ' + name + dayLabel;
      var description = [
        name,
        'โทร: ' + tel,
        'ราคา: ' + price + ' บาท',
        'รหัสจอง: ' + bookingId,
        'ชำระเงินแล้ว'
      ].join('\n');

      var event = CalendarApp.getDefaultCalendar().createEvent(
        title, startTime, endTime, { description: description }
      );
      event.setColor(CalendarApp.EventColor.GREEN);

      createdEvents.push({
        eventId: event.getId(),
        date: d,
        title: title
      });
    }

    return { success: true, events: createdEvents };
  } catch (err) {
    return { error: 'Calendar event failed: ' + err.message };
  }
}

// ─── PUBLIC DATA (for customer booking page — no auth) ───────

function getPublicCourseData() {
  const courses = getSheetData(SHEET.courses).filter(c => c.onlineBooking === true);
  const instructorAvail = getSheetData(SHEET.instructor_avail);
  return { courses, instructorAvail };
}

// ─── UTILITY ─────────────────────────────────────────────────

function testInit() {
  // Run this function manually to initialize all sheets
  const result = initializeSheets();
  Logger.log(JSON.stringify(result, null, 2));
}

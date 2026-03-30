// =============================================
// JIA Course — Supabase API Compatibility Layer
// แทน Google Apps Script API (Code.gs)
// include ไฟล์นี้แล้วลบ jiaApiGet/jiaApiPost เดิมออก
// =============================================

const SUPABASE_URL = "https://tpoiyykbgsgnrdwzgzvn.supabase.co";
const SUPABASE_KEY = "sb_publishable_1kXSE788PB9XqH_2vU3pqg_6xtqI1Mf";

// --- Initialize Supabase Client ---
const _sbClient = (typeof supabase !== 'undefined' && supabase.createClient)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// --- Low-level Supabase operations ---
async function _supa(table, method, body, filters) {
  // Try Supabase JS client first, fall back to REST
  if (_sbClient) {
    return _supaClient(table, method, body, filters);
  }
  return _supaREST(table, method, body, filters);
}

// --- Supabase JS Client implementation ---
async function _supaClient(table, method, body, filters) {
  if (method === "GET") {
    let q = _sbClient.from(table).select("*");
    if (filters) {
      const params = new URLSearchParams(filters.replace(/^\?/, ""));
      for (const [col, rawVal] of params.entries()) {
        const dotIdx = rawVal.indexOf(".");
        const op = rawVal.substring(0, dotIdx);
        const val = rawVal.substring(dotIdx + 1);
        if (op === "eq") q = q.eq(col, val);
        else if (op === "neq") q = q.neq(col, val);
        else if (op === "gt") q = q.gt(col, val);
        else if (op === "gte") q = q.gte(col, val);
        else if (op === "lt") q = q.lt(col, val);
        else if (op === "lte") q = q.lte(col, val);
        else if (op === "like") q = q.like(col, val);
        else if (op === "ilike") q = q.ilike(col, val);
        else if (op === "in") q = q.in(col, val.replace(/[()]/g, "").split(","));
      }
    }
    const { data, error } = await q;
    if (error) { console.error("Supabase GET error:", table, error); throw new Error(table + ": " + error.message); }
    return data || [];
  }

  if (method === "POST") {
    const normalized = Array.isArray(body) ? _normalizeRows(body) : body;
    const { data, error } = await _sbClient.from(table).insert(normalized).select();
    if (error) { console.error("Supabase POST error:", table, error); throw new Error(table + ": " + error.message); }
    return data || [];
  }

  if (method === "PATCH") {
    let q = _sbClient.from(table).update(body);
    if (filters) {
      const params = new URLSearchParams(filters.replace(/^\?/, ""));
      for (const [col, rawVal] of params.entries()) {
        const dotIdx = rawVal.indexOf(".");
        const op = rawVal.substring(0, dotIdx);
        const val = rawVal.substring(dotIdx + 1);
        if (op === "eq") q = q.eq(col, val);
        else if (op === "neq") q = q.neq(col, val);
      }
    }
    const { data, error } = await q.select();
    if (error) { console.error("Supabase PATCH error:", table, error); throw new Error(table + ": " + error.message); }
    return data || [];
  }

  if (method === "DELETE") {
    let q = _sbClient.from(table).delete();
    if (filters) {
      const params = new URLSearchParams(filters.replace(/^\?/, ""));
      for (const [col, rawVal] of params.entries()) {
        const dotIdx = rawVal.indexOf(".");
        const op = rawVal.substring(0, dotIdx);
        const val = rawVal.substring(dotIdx + 1);
        if (op === "eq") q = q.eq(col, val);
        else if (op === "neq") q = q.neq(col, val);
      }
    }
    const { error } = await q;
    if (error) { console.error("Supabase DELETE error:", table, error); throw new Error(table + ": " + error.message); }
    return [];
  }

  throw new Error("Unknown method: " + method);
}

// --- Supabase upsert via JS client ---
async function _supaUpsert(table, rows) {
  if (!_sbClient) {
    // REST fallback: POST with merge-duplicates
    return _supaREST(table, "POST", rows, null, true);
  }
  const normalized = Array.isArray(rows) ? _normalizeRows(rows) : rows;
  const { data, error } = await _sbClient.from(table).upsert(normalized, { ignoreDuplicates: false }).select();
  if (error) { console.error("Supabase upsert error:", table, error); throw new Error(table + ": " + error.message); }
  return data || [];
}

// --- REST API fallback ---
async function _supaREST(table, method, body, filters, upsert) {
  const url = SUPABASE_URL + "/rest/v1/" + table + (filters || "");
  const h = {
    apikey: SUPABASE_KEY,
    Authorization: "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json",
  };
  if (method === "POST" && upsert) h.Prefer = "return=representation,resolution=merge-duplicates";
  else if (method === "POST" || method === "PATCH") h.Prefer = "return=representation";
  const opts = { method, headers: h };
  const sendBody = (method === "POST" && Array.isArray(body)) ? _normalizeRows(body) : body;
  if (sendBody && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(sendBody);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    console.error("Supabase REST error:", method, table, err);
    throw new Error(table + ": " + err);
  }
  if (method === "DELETE") return [];
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// --- Supabase Storage (for slip upload) ---
async function _supaUpload(bucket, filePath, base64Data) {
  // Convert base64 to blob
  const byteChars = atob(base64Data.split(",").pop());
  const byteArr = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArr], { type: "image/jpeg" });

  if (_sbClient) {
    const { data, error } = await _sbClient.storage.from(bucket).upload(filePath, blob, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) throw new Error(error.message);
    return SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + filePath;
  }

  const url = SUPABASE_URL + "/storage/v1/object/" + bucket + "/" + filePath;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: blob,
  });
  if (!res.ok) throw new Error(await res.text());
  return SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + filePath;
}

// --- Normalize rows: ensure all objects have the same keys (PGRST102 fix) ---
function _normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length <= 1) return rows;
  const allKeys = new Set();
  rows.forEach(r => { if (r && typeof r === "object") Object.keys(r).forEach(k => allKeys.add(k)); });
  return rows.map(r => {
    const out = {};
    for (const k of allKeys) out[k] = r[k] !== undefined ? r[k] : null;
    return out;
  });
}

// --- Column name mapping (camelCase ↔ snake_case) ---
function toSnake(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(toSnake);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const sk = k.replace(/([A-Z])/g, "_$1").toLowerCase();
    out[sk] = v;
  }
  return out;
}

function toCamel(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[ck] = v;
  }
  return out;
}

// --- Sheet name → table name mapping ---
const SHEET_MAP = {
  users: "users",
  customers: "customers",
  bookings: "bookings",
  sessions: "sessions",
  courses: "courses",
  instructors: "instructors",
  instructor_avail: "instructor_avail",
  instructor_quals: "instructor_quals",
  classes: "classes",
  class_instructors: "class_instructors",
  promo_codes: "promo_codes",
  staff: "staff",
  invite_codes: "invite_codes",
  settings: "settings",
  pdpa_log: "pdpa_log",
  online_students: "online_students",
  online_purchases: "online_purchases",
  online_progress: "online_progress",
  sales_tracking: "sales_tracking",
};

// =============================================
// COMPATIBLE jiaApiGet / jiaApiPost
// =============================================

async function jiaApiGet(action, params) {
  params = params || {};
  return _handleAction(action, params, null);
}

async function jiaApiPost(action, params, body) {
  params = params || {};
  return _handleAction(action, params, body);
}

async function _handleAction(action, params, body) {
  const sheet = params.sheet || "";
  const table = SHEET_MAP[sheet] || sheet;

  switch (action) {
    // ========= DATA CRUD =========
    case "getData":
      return toCamel(await _supa(table, "GET"));

    case "saveRow": {
      const data = toSnake(body);
      // Use upsert to handle both insert and update
      try {
        return toCamel(await _supaUpsert(table, data));
      } catch(e) {
        // Fallback: check if exists then PATCH/POST
        if (data.id) {
          const existing = await _supa(table, "GET", null, "?id=eq." + encodeURIComponent(data.id));
          if (existing.length > 0) {
            return toCamel(await _supa(table, "PATCH", data, "?id=eq." + encodeURIComponent(data.id)));
          }
        }
        return toCamel(await _supa(table, "POST", data));
      }
    }

    case "updateRow": {
      const key = params.key || body._key || body.id;
      const keyCol = params.keyCol || body._keyCol || "id";
      const data = toSnake(body);
      delete data._key;
      delete data._key_col;
      return toCamel(await _supa(table, "PATCH", data, "?" + keyCol + "=eq." + encodeURIComponent(key)));
    }

    case "deleteRow": {
      const b = body || {};
      const key = params.key || b._key || b.id;
      const keyCol = params.keyCol || b._keyCol || "id";
      await _supa(table, "DELETE", null, "?" + keyCol + "=eq." + encodeURIComponent(key));
      return { status: "ok", success: true };
    }

    case "replaceSheet": {
      // Delete all rows then insert new data
      try {
        await _supa(table, "DELETE", null, "?id=neq.____impossible____");
      } catch (e) {
        console.warn("Clear failed (table might be empty):", e);
      }
      if (body && Array.isArray(body) && body.length > 0) {
        const rows = body.map(toSnake);
        for (let i = 0; i < rows.length; i += 100) {
          await _supa(table, "POST", rows.slice(i, i + 100));
        }
      }
      return { status: "ok" };
    }

    case "appendRows": {
      if (body && Array.isArray(body) && body.length > 0) {
        return toCamel(await _supa(table, "POST", body.map(toSnake)));
      }
      return [];
    }

    case "clearSheet":
      await _supa(table, "DELETE", null, "?id=neq.____impossible____");
      return { status: "ok" };

    // ========= AUTH =========
    case "loginPassword": {
      const b = body || {};
      const username = b.username || params.username;
      const password = b.password || params.password;
      const users = await _supa("users", "GET", null, "?username=eq." + encodeURIComponent(username));
      if (users.length === 0) return { success: false, message: "ไม่พบผู้ใช้" };
      if (users[0].password_hash !== password) return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };
      await _supa("users", "PATCH", { last_login: new Date().toISOString() }, "?username=eq." + encodeURIComponent(users[0].username));
      return { success: true, username: users[0].username, name: users[0].name, role: users[0].role };
    }

    case "registerPassword": {
      const b = body || {};
      const code = b.code || params.code;
      const username = b.username || params.username;
      const name = b.name || params.name;
      const password = b.password || params.password;

      const existing = await _supa("users", "GET", null, "?username=eq." + encodeURIComponent(username));
      if (existing.length > 0) return { status: "error", message: "ชื่อผู้ใช้ซ้ำ" };

      const codes = await _supa("invite_codes", "GET", null, "?code=eq." + encodeURIComponent(code) + "&status=eq.active");
      if (codes.length === 0) return { status: "error", message: "รหัสเชิญไม่ถูกต้อง" };

      await _supa("users", "POST", {
        username,
        name,
        role: codes[0].role,
        password_hash: password,
      });
      await _supa("invite_codes", "PATCH", {
        status: "used",
        used_by: username,
        used_at: new Date().toISOString(),
      }, "?code=eq." + encodeURIComponent(code));

      return { status: "ok", role: codes[0].role };
    }

    case "checkUsername": {
      const b = body || {};
      const u = await _supa("users", "GET", null, "?username=eq." + encodeURIComponent(params.username || b.username));
      if (u.length > 0) return { exists: true, registered: true, name: u[0].name, role: u[0].role };
      return { exists: false, registered: false };
    }

    case "checkUser": {
      const b = body || {};
      const u = await _supa("users", "GET", null, "?username=eq." + encodeURIComponent(params.email || b.email));
      return { exists: u.length > 0 };
    }

    case "listUsers":
      return toCamel(await _supa("users", "GET"));

    case "resetPassword": {
      const b = body || {};
      await _supa("users", "PATCH", {
        password_hash: b.newPassword || params.newPassword,
      }, "?username=eq." + encodeURIComponent(b.targetUser || params.targetUser));
      return { status: "ok", success: true };
    }

    // ========= ALL DATA =========
    case "getAllData": {
      const [customers, bookings, sessions, courses, instructors,
        instructorAvail, instructorQuals, classes, classInstructors,
        promoCodes, staff, settings, inviteCodes, pdpaLog] = await Promise.all([
        _supa("customers", "GET"),
        _supa("bookings", "GET"),
        _supa("sessions", "GET"),
        _supa("courses", "GET"),
        _supa("instructors", "GET"),
        _supa("instructor_avail", "GET"),
        _supa("instructor_quals", "GET"),
        _supa("classes", "GET"),
        _supa("class_instructors", "GET"),
        _supa("promo_codes", "GET"),
        _supa("staff", "GET"),
        _supa("settings", "GET"),
        _supa("invite_codes", "GET"),
        _supa("pdpa_log", "GET"),
      ]);
      return {
        customers: toCamel(customers),
        bookings: toCamel(bookings),
        sessions: toCamel(sessions),
        courses: toCamel(courses),
        instructors: toCamel(instructors),
        instructor_avail: toCamel(instructorAvail),
        instructor_quals: toCamel(instructorQuals),
        classes: toCamel(classes),
        class_instructors: toCamel(classInstructors),
        promo_codes: toCamel(promoCodes),
        staff: toCamel(staff),
        settings: toCamel(settings),
        invite_codes: toCamel(inviteCodes),
        pdpa_log: toCamel(pdpaLog),
      };
    }

    case "saveAll": {
      // body = { sheetName: [rows], ... }
      // Primary key column per table
      const PK = { settings: "key", courses: "key", promo_codes: "code", instructor_quals: "instructor" };
      const entries = Object.entries(body).filter(([s, rows]) => rows && rows.length > 0);
      const results = await Promise.allSettled(
        entries.map(async ([s, rows]) => {
          const t = SHEET_MAP[s] || s;
          const pk = PK[t] || "id";
          const snaked = rows.map(toSnake);
          let saved = 0, skipped = 0;
          for (const row of snaked) {
            try {
              // Try upsert first
              await _supaUpsert(t, row);
              saved++;
            } catch(e) {
              // Upsert failed — try PATCH (update existing row by primary key)
              const pkVal = row[pk];
              if (pkVal) {
                try {
                  await _supa(t, "PATCH", row, "?" + pk + "=eq." + encodeURIComponent(pkVal));
                  saved++;
                } catch(e2) {
                  // PATCH failed — try INSERT as last resort
                  try {
                    await _supa(t, "POST", row);
                    saved++;
                  } catch(e3) {
                    console.warn("⚠️ Skip row in " + t + " (" + pk + "=" + pkVal + "):", e3.message);
                    skipped++;
                  }
                }
              } else {
                // No PK value — try INSERT
                try {
                  await _supa(t, "POST", row);
                  saved++;
                } catch(e2) {
                  console.warn("⚠️ Skip row in " + t + " (no pk):", e2.message);
                  skipped++;
                }
              }
            }
          }
          console.log("✅ " + t + ": saved=" + saved + " skipped=" + skipped);
          if (saved === 0 && snaked.length > 0) throw new Error(t + ": ไม่สามารถบันทึกได้เลย");
          return t;
        })
      );
      const failed = results
        .map((r, i) => r.status === "rejected" ? entries[i][0] + ": " + r.reason.message : null)
        .filter(Boolean);
      if (failed.length > 0) {
        console.warn("⚠️ saveAll failures:", failed);
      }
      if (failed.length > 0 && failed.length === entries.length) {
        throw new Error("ทุกตารางล้มเหลว — " + failed[0]);
      }
      return { status: "ok", failed };
    }

    // ========= INVITE CODES =========
    case "genCode": {
      const role = body.role || params.role;
      const code = role.slice(0, 1).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
      await _supa("invite_codes", "POST", {
        code,
        role,
        created_by: body.username || body.email || params.username || "",
        level: body.level || params.level || 1,
        status: "active",
      });
      return { status: "ok", code };
    }
    case "listCodes":
      return toCamel(await _supa("invite_codes", "GET"));

    // ========= INSTRUCTOR =========
    case "ensureInstructor": {
      const name = body.name || params.name;
      const existing = await _supa("instructors", "GET", null, "?name=eq." + encodeURIComponent(name));
      if (existing.length > 0) return { status: "ok", id: existing[0].id };
      const id = "inst_" + Date.now();
      await _supa("instructors", "POST", { id, name, level: 1 });
      await _supa("instructor_quals", "POST", { instructor_id: id, courses: "" });
      return { status: "ok", id };
    }

    // ========= CLASS =========
    case "acceptClass": {
      const classId = body.classId || params.classId;
      const instructor = body.instructor || params.instructor;
      await _supa("class_instructors", "POST", {
        id: "ci_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
        class_id: classId,
        instructor_id: instructor,
        assigned_by: body.assignedBy || params.assignedBy || "",
      });
      const cls = await _supa("classes", "GET", null, "?id=eq." + encodeURIComponent(classId));
      if (cls.length > 0) {
        const n = (cls[0].current_instructors || 0) + 1;
        const st = n >= cls[0].required_instructors ? "ready" : "waiting_instructor";
        await _supa("classes", "PATCH", { current_instructors: n, status: st }, "?id=eq." + encodeURIComponent(classId));
      }
      return { status: "ok" };
    }
    case "addClassInstructor":
      return _supa("class_instructors", "POST", toSnake(body));
    case "updateClassStatus": {
      const cid = body.classId || params.classId;
      return _supa("classes", "PATCH", toSnake(body), "?id=eq." + encodeURIComponent(cid));
    }

    // ========= FILE UPLOAD =========
    case "uploadSlip": {
      const fileName = (body.fileName || "slip") + "_" + Date.now() + ".jpg";
      try {
        const publicUrl = await _supaUpload("slips", fileName, body.base64);
        if (body.bookingId) {
          try {
            await _supa("bookings", "PATCH", {
              payment_slip: publicUrl,
              payment_status: "แจ้งชำระแล้ว",
            }, "?id=eq." + encodeURIComponent(body.bookingId));
          } catch (e) { console.warn("Update booking slip failed:", e); }
        }
        return { success: true, url: publicUrl };
      } catch (e) {
        console.error("Upload failed:", e);
        return { success: false, error: e.message };
      }
    }

    // ========= NOTIFICATIONS (no-op for now) =========
    case "notifyBooking":
    case "notifyPayment":
    case "notifyNewClass":
    case "notifyInstructorAccepted":
      console.log("📢 Notification:", action, body);
      return { status: "ok", message: "Notification logged (webhook not configured yet)" };

    // ========= CALENDAR (no-op) =========
    case "createCalendarEvent":
      console.log("📅 Calendar event:", body);
      return { status: "ok" };

    // ========= INIT =========
    case "init":
      return { status: "ok", message: "Tables already created in Supabase" };

    default:
      console.warn("Unknown action:", action);
      return { status: "error", message: "Unknown action: " + action };
  }
}

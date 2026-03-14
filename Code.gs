// ══════════════════════════════════════════════════════════════
// JIA Course — Google Apps Script v2.0
// ══════════════════════════════════════════════════════════════
// วิธีใช้:
// 1. เปิด Google Sheets → Extensions → Apps Script
// 2. ลบโค้ดเดิมทั้งหมด → วางโค้ดนี้
// 3. กดปุ่ม ▶ รัน function "testSetup" ก่อน 1 ครั้ง
//    (จะสร้าง 3 sheets พร้อม headers อัตโนมัติ)
// 4. กด Deploy → New deployment → Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 5. คัดลอก URL → วางในหน้า "ตั้งค่า" ของระบบ JIA Course
// ══════════════════════════════════════════════════════════════

const SS = SpreadsheetApp.getActiveSpreadsheet();

// ─── คอลัมน์ที่ต้องการในแต่ละ sheet ───
const CUSTOMER_COLS = [
  "id", "name", "phone", "email", "qrCode", "bookingCode",
  "consentPDPA", "consentDate", "createdAt"
];

const BOOKING_COLS = [
  "id", "bookingCode", "customerId", "customerName",
  "courseType", "courseName", "totalPeople", "totalSessions",
  "timeSlot", "startDate",
  "instructor1", "instructor2", "instructor3",
  "salesName", "paymentStatus", "cash",
  "registeredCount", "notes", "createdAt"
];

const SESSION_COLS = [
  "id", "bookingId", "customerId", "sessionNo",
  "done", "date", "note",
  "examResult", "examScore", "examNote"
];

// ══════════════════════════════════════════════════════════════
// Main handler
// ══════════════════════════════════════════════════════════════
function doGet(e) {
  var p = e.parameter;
  var cb = p.callback;
  var result = {};

  try {
    if (p.action === "get") {
      result = {
        customers: getSheetData("customers", CUSTOMER_COLS),
        bookings:  getSheetData("bookings", BOOKING_COLS),
        sessions:  getSheetData("sessions", SESSION_COLS)
      };
    }
    else if (p.action === "addCustomer") {
      upsertRow("customers", parseData(p.data), "id", CUSTOMER_COLS);
      result = { ok: true };
    }
    else if (p.action === "addBooking") {
      upsertRow("bookings", parseData(p.data), "id", BOOKING_COLS);
      result = { ok: true };
    }
    else if (p.action === "addSession") {
      upsertRow("sessions", parseData(p.data), "id", SESSION_COLS);
      result = { ok: true };
    }
    else if (p.action === "updateSession") {
      updateSessionDone(p.id, p.value);
      result = { ok: true };
    }
    else if (p.action === "deleteBooking") {
      deleteRows("bookings", "id", p.id);
      deleteRows("sessions", "bookingId", p.id);
      result = { ok: true };
    }
    else if (p.action === "deleteCustomer") {
      deleteRows("customers", "id", p.id);
      result = { ok: true };
    }
    else {
      result = { error: "unknown action: " + p.action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  var json = JSON.stringify(result);
  if (cb) {
    return ContentService.createTextOutput(cb + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

function parseData(b64str) {
  var raw = Utilities.newBlob(Utilities.base64Decode(b64str)).getDataAsString();
  return JSON.parse(raw);
}

// ─── Get or create sheet with correct headers ───
function getOrCreateSheet(name, cols) {
  var sheet = SS.getSheetByName(name);
  if (!sheet) {
    sheet = SS.insertSheet(name);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.getRange(1, 1, 1, cols.length)
      .setFontWeight("bold")
      .setBackground("#e8eeff");
    sheet.setFrozenRows(1);
  } else {
    // ตรวจสอบว่ามีคอลัมน์ครบไหม ถ้าไม่ครบให้เพิ่ม
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) lastCol = 1;
    var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var c = 0; c < cols.length; c++) {
      if (existing.indexOf(cols[c]) === -1) {
        existing.push(cols[c]);
        sheet.getRange(1, existing.length).setValue(cols[c]).setFontWeight("bold");
      }
    }
  }
  return sheet;
}

// ─── Read all data from sheet ───
function getSheetData(sheetName, cols) {
  var sheet = getOrCreateSheet(sheetName, cols);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
      }
      obj[headers[j]] = val;
    }
    if (obj.id) rows.push(obj);
  }
  return rows;
}

// ─── Upsert (insert or update) a row ───
function upsertRow(sheetName, data, keyField, cols) {
  var sheet = getOrCreateSheet(sheetName, cols);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // สร้าง row values ตาม headers
  var rowValues = [];
  for (var h = 0; h < headers.length; h++) {
    var val = data[headers[h]];
    if (val === undefined || val === null) { rowValues.push(""); continue; }
    if (Array.isArray(val)) { rowValues.push(val.join(", ")); continue; }
    rowValues.push(val);
  }

  // หา row เดิมด้วย key
  var keyCol = headers.indexOf(keyField);
  if (keyCol >= 0 && data[keyField]) {
    var allData = sheet.getDataRange().getValues();
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][keyCol]) === String(data[keyField])) {
        // อัปเดตเฉพาะ field ที่ส่งมา (ไม่เขียนทับ field ที่ไม่ได้ส่ง)
        var updatedRow = [];
        for (var j = 0; j < headers.length; j++) {
          if (data[headers[j]] !== undefined && data[headers[j]] !== null) {
            var v = data[headers[j]];
            if (Array.isArray(v)) { updatedRow.push(v.join(", ")); }
            else { updatedRow.push(v); }
          } else {
            updatedRow.push(allData[i][j]); // เก็บค่าเดิม
          }
        }
        sheet.getRange(i + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
        return;
      }
    }
  }

  // Insert row ใหม่
  sheet.appendRow(rowValues);
}

// ─── Update session done status ───
function updateSessionDone(sessionId, doneValue) {
  var sheet = getOrCreateSheet("sessions", SESSION_COLS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf("id");
  var doneCol = headers.indexOf("done");
  var dateCol = headers.indexOf("date");

  if (idCol < 0) return;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(sessionId)) {
      var isDone = (doneValue === "true");
      if (doneCol >= 0) {
        sheet.getRange(i + 1, doneCol + 1).setValue(isDone);
      }
      if (dateCol >= 0) {
        sheet.getRange(i + 1, dateCol + 1).setValue(
          isDone ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") : ""
        );
      }
      break;
    }
  }
}

// ─── Delete rows by field value ───
function deleteRows(sheetName, field, value) {
  var sheet = SS.getSheetByName(sheetName);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var col = headers.indexOf(field);
  if (col < 0) return;

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]) === String(value)) {
      sheet.deleteRow(i + 1);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// ★ รันครั้งแรก — สร้าง 3 sheets พร้อม headers
// ══════════════════════════════════════════════════════════════
function testSetup() {
  getOrCreateSheet("customers", CUSTOMER_COLS);
  getOrCreateSheet("bookings", BOOKING_COLS);
  getOrCreateSheet("sessions", SESSION_COLS);
  Logger.log("✅ สร้าง 3 sheets สำเร็จ!");
  Logger.log("");
  Logger.log("📋 customers: " + CUSTOMER_COLS.join(" | "));
  Logger.log("📋 bookings:  " + BOOKING_COLS.join(" | "));
  Logger.log("📋 sessions:  " + SESSION_COLS.join(" | "));
  Logger.log("");
  Logger.log("ขั้นตอนต่อไป: Deploy → New deployment → Web app");
}

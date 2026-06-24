/**
 * 声つき4コマ劇場 — 簡易サーバーレジストリ (Google Apps Script)
 *
 * Google Sheets を「いま使えるColabサーバー一覧」として使う。
 * Colab 起動コードから register / heartbeat され、React から list / assign される。
 *
 * 列: serverId | color | label | apiUrl | enabled | capacity | assignedCount | lastSeen
 *
 * デプロイ: 「デプロイ > 新しいデプロイ > ウェブアプリ」
 *   - 実行するユーザー: 自分
 *   - アクセスできるユーザー: 全員
 *   発行された /exec URL を GAS_URL として React(.env) と Colab に設定する。
 */

var SHEET_NAME = 'servers';
var HEADERS = ['serverId', 'color', 'label', 'apiUrl', 'enabled', 'capacity', 'assignedCount', 'lastSeen'];

// 在席（TTL）方式の負荷カウント用。端末が presence を送り続けている間だけ「在席」とみなす。
var PRESENCE_SHEET = 'presence';
var PRESENCE_HEADERS = ['deviceId', 'serverId', 'lastSeen'];
var PRESENCE_TTL_MS = 90 * 1000; // この秒数以内に presence が来た端末を「在席中」と数える

/** 初回に一度だけ実行: シートとヘッダーを用意する。 */
function setup() {
  var sheet = getSheet_();
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  var p = getPresenceSheet_();
  p.clear();
  p.getRange(1, 1, 1, PRESENCE_HEADERS.length).setValues([PRESENCE_HEADERS]);
  SpreadsheetApp.getActiveSpreadsheet().toast('servers / presence シートを初期化しました');
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

function getPresenceSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PRESENCE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PRESENCE_SHEET);
    sheet.getRange(1, 1, 1, PRESENCE_HEADERS.length).setValues([PRESENCE_HEADERS]);
  }
  return sheet;
}

/** presence シートを読む（1端末1行、deviceId がキー）。 */
function readPresence_() {
  var sheet = getPresenceSheet_();
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[0]) continue;
    rows.push({
      rowIndex: r + 1,
      deviceId: String(row[0]),
      serverId: String(row[1]),
      lastSeen: row[2] ? Number(row[2]) : 0
    });
  }
  return rows;
}

/** serverId -> 在席中の端末数（TTL以内）を返す。 */
function activeCounts_(now) {
  var rows = readPresence_();
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    if (now - rows[i].lastSeen <= PRESENCE_TTL_MS) {
      map[rows[i].serverId] = (map[rows[i].serverId] || 0) + 1;
    }
  }
  return map;
}

/** 全行をオブジェクト配列で読む。 */
function readRows_() {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[0]) continue; // serverId なし行はスキップ
    rows.push({
      rowIndex: r + 1, // 1始まり（ヘッダー込み）
      serverId: String(row[0]),
      color: String(row[1]),
      label: String(row[2]),
      apiUrl: String(row[3]),
      enabled: row[4] === true || String(row[4]).toLowerCase() === 'true',
      capacity: Number(row[5]) || 0,
      assignedCount: Number(row[6]) || 0,
      lastSeen: row[7] ? Number(row[7]) : 0
    });
  }
  return rows;
}

function findRow_(rows, serverId) {
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].serverId === serverId) return rows[i];
  }
  return null;
}

function writeRow_(sheet, rowIndex, obj) {
  sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([[
    obj.serverId, obj.color, obj.label, obj.apiUrl,
    obj.enabled, obj.capacity, obj.assignedCount, obj.lastSeen
  ]]);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** GET: action=list でサーバー一覧を返す。 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'list';
  if (action === 'list') {
    var now = Date.now();
    var active = activeCounts_(now);
    var rows = readRows_().map(function (r) {
      return {
        serverId: r.serverId, color: r.color, label: r.label, apiUrl: r.apiUrl,
        enabled: r.enabled, capacity: r.capacity, assignedCount: r.assignedCount,
        activeCount: active[r.serverId] || 0, // TTL方式のライブ負荷
        lastSeen: r.lastSeen
      };
    });
    return jsonOut_({ servers: rows });
  }
  return jsonOut_({ error: 'unknown action: ' + action });
}

/** POST: register / heartbeat / assign / release / disable / presence を処理する。 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // 同時更新を防ぐ
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || '';
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    }
    var serverId = body.serverId || params.serverId || '';
    if (!serverId) return jsonOut_({ error: 'serverId required' });

    var sheet = getSheet_();
    var rows = readRows_();
    var existing = findRow_(rows, serverId);
    var now = Date.now();

    if (action === 'register') {
      var rec = {
        serverId: serverId,
        color: body.color || (existing ? existing.color : ''),
        label: body.label || (existing ? existing.label : ''),
        apiUrl: body.apiUrl || (existing ? existing.apiUrl : ''),
        enabled: true,
        capacity: body.capacity != null ? Number(body.capacity) : (existing ? existing.capacity : 2),
        assignedCount: 0, // 登録時に割り当て数をリセット
        lastSeen: now
      };
      if (existing) {
        writeRow_(sheet, existing.rowIndex, rec);
      } else {
        sheet.appendRow([rec.serverId, rec.color, rec.label, rec.apiUrl,
          rec.enabled, rec.capacity, rec.assignedCount, rec.lastSeen]);
      }
      return jsonOut_({ ok: true, action: 'register', server: rec });
    }

    if (action === 'heartbeat') {
      if (!existing) return jsonOut_({ error: 'not registered: ' + serverId });
      existing.lastSeen = now;
      existing.enabled = true;
      if (body.apiUrl) existing.apiUrl = body.apiUrl; // URL が変わった場合に更新
      writeRow_(sheet, existing.rowIndex, existing);
      return jsonOut_({ ok: true, action: 'heartbeat' });
    }

    if (action === 'assign') {
      if (!existing) return jsonOut_({ error: 'not registered: ' + serverId });
      existing.assignedCount = existing.assignedCount + 1;
      writeRow_(sheet, existing.rowIndex, existing);
      return jsonOut_({ ok: true, action: 'assign', assignedCount: existing.assignedCount });
    }

    if (action === 'release') {
      if (!existing) return jsonOut_({ error: 'not registered: ' + serverId });
      existing.assignedCount = Math.max(0, existing.assignedCount - 1);
      writeRow_(sheet, existing.rowIndex, existing);
      return jsonOut_({ ok: true, action: 'release', assignedCount: existing.assignedCount });
    }

    if (action === 'disable') {
      if (!existing) return jsonOut_({ error: 'not registered: ' + serverId });
      existing.enabled = false;
      writeRow_(sheet, existing.rowIndex, existing);
      return jsonOut_({ ok: true, action: 'disable' });
    }

    // 在席ハートビート: 端末が「このサーバーで使用中」と定期的に知らせる。
    // 1端末=1行（deviceId がキー）。serverId は最新のものに更新（サーバー移動に対応）。
    if (action === 'presence') {
      var deviceId = body.deviceId || params.deviceId || '';
      if (!deviceId) return jsonOut_({ error: 'deviceId required' });
      var psheet = getPresenceSheet_();
      var prows = readPresence_();
      var pfound = null;
      for (var pi = 0; pi < prows.length; pi++) {
        if (prows[pi].deviceId === deviceId) { pfound = prows[pi]; break; }
      }
      if (pfound) {
        psheet.getRange(pfound.rowIndex, 1, 1, PRESENCE_HEADERS.length)
          .setValues([[deviceId, serverId, now]]);
      } else {
        psheet.appendRow([deviceId, serverId, now]);
      }
      return jsonOut_({ ok: true, action: 'presence' });
    }

    return jsonOut_({ error: 'unknown action: ' + action });
  } finally {
    lock.releaseLock();
  }
}

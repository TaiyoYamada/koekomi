/**
 * コエコミ — サーバー名簿 (Google Apps Script)
 *
 * やることは1つだけ: **「今日の3つのURLを配る」**。
 *
 * 以前はここが負荷分散器も兼ねていた（presence / assign / release /
 * activeCount / capacity / assignedCount）。だが端末は最大10人、
 * サーバーは3台（Colab Pro+）で、GPU は余る。分散させる必要が無い。
 *
 * その負荷分散のために、端末20台 × 毎分2回 = 40 write/分 が単一の
 * ScriptLock を通っていて、GAS が詰まる主因になっていた。しかも
 * presence が落ちると全サーバーの負荷が 0 に見え、**全端末が同じ1台に
 * 殺到する**（フェイルセーフの向きが逆）という壊れ方をしていた。
 *
 * 負荷分散をやめた結果、書き込みは heartbeat だけになる:
 *     3台 × 2回/分 = 6 write/分（以前の 1/10）。
 * 分散はクライアント側で deviceId のハッシュで行う（通信ゼロ）。
 * 冗長化はクライアント側の /health リトライで行う（調整ゼロ）。
 *
 * 列: serverId | color | label | apiUrl | enabled | lastSeen
 *
 * デプロイ: 「デプロイ > 新しいデプロイ > ウェブアプリ」
 *   - 実行するユーザー: 自分
 *   - アクセスできるユーザー: 全員
 *   発行された /exec URL を GAS_URL として React(.env) と Colab に設定する。
 */

var SHEET_NAME = 'servers';
var HEADERS = ['serverId', 'color', 'label', 'apiUrl', 'enabled', 'lastSeen'];

/** 初回に一度だけ実行: シートとヘッダーを用意する。 */
function setup() {
  var sheet = getSheet_();
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  // 旧構成の presence シートが残っていれば片付ける。
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName('presence');
  if (old) ss.deleteSheet(old);
  ss.toast('servers シートを初期化しました');
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

/** 全行をオブジェクト配列で読む。 */
function readRows_() {
  var values = getSheet_().getDataRange().getValues();
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
      lastSeen: row[5] ? Number(row[5]) : 0
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
    obj.serverId, obj.color, obj.label, obj.apiUrl, obj.enabled, obj.lastSeen
  ]]);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** GET: action=list でサーバー一覧を返す（読み取りのみ。ロック不要）。 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'list';
  if (action !== 'list') return jsonOut_({ error: 'unknown action: ' + action });

  var rows = readRows_().map(function (r) {
    return {
      serverId: r.serverId,
      color: r.color,
      label: r.label,
      apiUrl: r.apiUrl,
      enabled: r.enabled,
      lastSeen: r.lastSeen
    };
  });
  return jsonOut_({ servers: rows });
}

/** POST: register / heartbeat / disable。Colab からしか呼ばれない。 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  // 書き込みは 3台 × 2回/分 しか来ないので、待たされることはまず無い。
  // それでも取れなければ、HTMLのエラーページではなくJSONで返す
  // （呼び出し側が res.json() で落ちないように）。
  try {
    lock.waitLock(10000);
  } catch (err) {
    return jsonOut_({ error: 'busy' });
  }

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
    var existing = findRow_(readRows_(), serverId);
    var now = Date.now();

    if (action === 'register') {
      var rec = {
        serverId: serverId,
        color: body.color || (existing ? existing.color : ''),
        label: body.label || (existing ? existing.label : ''),
        apiUrl: body.apiUrl || (existing ? existing.apiUrl : ''),
        enabled: true,
        lastSeen: now
      };
      if (existing) {
        writeRow_(sheet, existing.rowIndex, rec);
      } else {
        sheet.appendRow([rec.serverId, rec.color, rec.label, rec.apiUrl, rec.enabled, rec.lastSeen]);
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

    if (action === 'disable') {
      if (!existing) return jsonOut_({ error: 'not registered: ' + serverId });
      existing.enabled = false;
      writeRow_(sheet, existing.rowIndex, existing);
      return jsonOut_({ ok: true, action: 'disable' });
    }

    return jsonOut_({ error: 'unknown action: ' + action });
  } finally {
    lock.releaseLock();
  }
}

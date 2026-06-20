/**
 * Cash Flow Tracker — backend (Google Apps Script web app, backed by a Google Sheet).
 * The whole app state is stored as JSON in cell A1 of a "state" sheet. Simple + robust for one user.
 *
 * Setup (one time, ~3 min):
 *   1. Create a new Google Sheet (sheets.new).
 *   2. Extensions -> Apps Script. Delete the sample, paste THIS file, save.
 *   3. Deploy -> New deployment -> type "Web app".
 *        Execute as: Me.  Who has access: Anyone.   -> Deploy. Authorize when asked.
 *   4. Copy the Web app URL (ends in /exec).
 *   5. In the Cash Flow app: Settings -> "Cloud sync URL" -> paste -> Save.
 */

const SHEET_NAME = 'state';

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); }
  return sh;
}

function doGet() {
  const raw = getSheet_().getRange('A1').getValue();
  let state = null;
  try { state = raw ? JSON.parse(raw) : null; } catch (e) { state = null; }
  return json_({ ok: true, state: state });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body && body.state) {
      getSheet_().getRange('A1').setValue(JSON.stringify(body.state));
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

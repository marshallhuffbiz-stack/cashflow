/**
 * Cash Flow Tracker — backend (Google Apps Script web app).
 * Stores the whole app state as JSON in a SCRIPT PROPERTY. No Sheet, and no sensitive OAuth
 * scopes, so it deploys WITHOUT an authorization prompt.
 *
 * DEPLOYED 2026-06-20 as a standalone web app (Execute as: Me, Who has access: Anyone).
 * The /exec URL is effectively the secret token — it lives in the app's Settings and in the
 * private import link, NOT in this public repo.
 *
 * Note: a script property holds up to ~9KB; the personal state is ~2KB, with slow growth from
 * monthly archives. If it ever approaches the limit, switch storage to a bound Google Sheet cell.
 */
function doGet() {
  var v = PropertiesService.getScriptProperties().getProperty('cft_state');
  return ContentService.createTextOutput(JSON.stringify({ ok: true, state: v ? JSON.parse(v) : null }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);
    if (b && b.state) PropertiesService.getScriptProperties().setProperty('cft_state', JSON.stringify(b.state));
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

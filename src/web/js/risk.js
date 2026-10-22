// Sift-style device and behaviour signals, sent with sign-up, login and payment requests and scored on the server
// (governance/risk.py). Nothing personal: a random device id kept in this browser, display/locale facts, an
// automation flag, and how the form was filled (time, key count, pastes). Never the typed values.
const KEY = "ap.device";

function deviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
    return id;
  } catch { return ""; }  // private mode: no stable id (the server treats that as a weak signal only)
}

/** Watch a form; call the returned function at submit time to get its signals.
 * fill_ms counts from when the form appeared (a bot submits right away), not from the first key: autofill, password
 * managers and some mobile keyboards type without key events. keys counts edits (input events) or key presses. */
export function watchForm(form) {
  const shown = performance.now();
  let keys = 0, inputs = 0, pastes = 0;
  form.addEventListener("keydown", () => { keys++; });
  form.addEventListener("input", () => { inputs++; });
  form.addEventListener("paste", () => { pastes++; });
  return () => ({
    device_id: deviceId(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    lang: navigator.language || "",
    screen: `${screen.width}x${screen.height}`,
    platform: navigator.userAgentData?.platform || navigator.platform || "",
    touch: navigator.maxTouchPoints > 0,
    webdriver: navigator.webdriver === true,
    fill_ms: Math.round(performance.now() - shown),
    keys: Math.max(keys, inputs), pastes,
  });
}

/** Signals without a form (e.g. starting a payment). */
export const pageSignals = () => watchForm(document.createElement("form"))();

// Deployment config for the static frontend. Same-origin (served by the API): leave apiBase empty.
// Separate deploy (e.g. static host + API elsewhere): set apiBase to the API origin, e.g. "https://api.example.com",
// and add this site's origin to the API's CORS_ORIGINS. Overwrite this file at deploy time; no build step needed.
window.AP_CONFIG = { apiBase: "", VIRTUAL_INTERVIEW_3D: true, ...(window.AP_CONFIG || {}) };

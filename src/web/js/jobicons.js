// One drawn icon per job family, so people can recognise a job before reading its title.
// ESCO occupation codes start with their ISCO-08 sub-major group (e.g. "2221.2" -> 22, health professionals),
// so the family comes from the code itself: no lookup on the server, no guessing from the title.
// Static, authored path data only (same 24px grid and stroke as lib.js icons); nothing user-supplied is inserted.

const P = {
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z",
  briefcase: "M4 8h16v11H4z M9 8V5h6v3 M4 13h16",
  factory: "M3 20h18 M4 20v-9l5 3v-3l5 3V5h4v15",
  bed: "M3 18V7 M3 14h18v4 M21 14v-1a3 3 0 0 0-3-3h-7v4 M7 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  flask: "M9 3h6 M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3 M7.5 15h9",
  health: "M20.5 9c0 5-8.5 11-8.5 11S3.5 14 3.5 9A4.5 4.5 0 0 1 12 6.5 4.5 4.5 0 0 1 20.5 9z M3.5 12.5h4l2-3 3 6 2-3h6",
  cap: "M2 9l10-5 10 5-10 5z M6 11v5c3 2 9 2 12 0v-5 M22 9v5",
  laptop: "M5 6h14v9H5z M3 18h18",
  scale: "M12 4v16 M8 20h8 M5 7h14 M5 7l-3 6a3 3 0 0 0 6 0z M19 7l-3 6a3 3 0 0 0 6 0z",
  wrench: "M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-1-1-3z",
  medkit: "M5 7h14v13H5z M9 7V4h6v3 M12 10v7 M8.5 13.5h7",
  chart: "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20a6 6 0 0 1 12 0 M16 5a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 6",
  chip: "M7 7h10v10H7z M10 10h4v4h-4z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  cup: "M4 9h12v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z M16 10h1.5a2 2 0 0 1 0 4H16 M8 3v3 M12 3v3",
  bag: "M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2",
  care: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  guard: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4",
  leaf: "M5 19c0-8 5-13 14-14 0 9-5 14-13 14z M5 19l7-7",
  house: "M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6",
  cog: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9 7 7 M17 17l2.1 2.1 M4.9 19.1 7 17 M17 7l2.1-2.1",
  palette: "M12 3a9 9 0 0 0 0 18c1.4 0 2-.9 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z M7.5 11h.01 M10 7.5h.01 M14.5 7.5h.01",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.5 7.5 20 19 M8.5 16.5 20 5",
  layers: "M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  truck: "M3 6h11v10H3z M14 10h4l3 3v3h-7 M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  sparkle: "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z",
  box: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  utensils: "M7 3v8 M5 3v5a2 2 0 0 0 4 0V3 M7 11v10 M17 3c-2 1-3 4-3 7h3v11",
  bin: "M4 6h16 M9 6V4h6v2 M6 6l1 14h10l1-14 M10 10v6 M14 10v6",
  job: "M4 8h16v11H4z M9 8V5h6v3",
};

// ISCO-08 sub-major group -> [icon, short family name]
const FAMILY = {
  "01": ["shield", "Armed forces"], "02": ["shield", "Armed forces"], "03": ["shield", "Armed forces"],
  "11": ["briefcase", "Executives"], "12": ["briefcase", "Managers"], "13": ["factory", "Production managers"],
  "14": ["bed", "Hospitality managers"],
  "21": ["flask", "Science & engineering"], "22": ["health", "Health"], "23": ["cap", "Teaching"],
  "24": ["briefcase", "Business & admin"], "25": ["laptop", "IT & software"], "26": ["scale", "Law, culture & social"],
  "31": ["wrench", "Technicians"], "32": ["medkit", "Health support"], "33": ["chart", "Business support"],
  "34": ["people", "Community & culture"], "35": ["chip", "IT support"],
  "41": ["folder", "Office"], "42": ["folder", "Customer service"], "43": ["folder", "Records & numbers"], "44": ["folder", "Office"],
  "51": ["cup", "Personal services"], "52": ["bag", "Sales"], "53": ["care", "Personal care"], "54": ["guard", "Protection & safety"],
  "61": ["leaf", "Farming & fishing"], "62": ["leaf", "Forestry & fishing"], "63": ["leaf", "Subsistence farming"],
  "71": ["house", "Building"], "72": ["cog", "Metal & machinery"], "73": ["palette", "Crafts & printing"],
  "74": ["bolt", "Electrical"], "75": ["scissors", "Food, wood & garments"],
  "81": ["factory", "Plant operators"], "82": ["layers", "Assembly"], "83": ["truck", "Drivers"],
  "91": ["sparkle", "Cleaning"], "92": ["leaf", "Farm labour"], "93": ["box", "Labour & logistics"],
  "94": ["utensils", "Food preparation"], "95": ["bin", "Street services"], "96": ["bin", "Refuse & other"],
};

// one hue per ISCO major group (first digit), so related families share a colour
const HUE = { 0: 255, 1: 280, 2: 255, 3: 200, 4: 230, 5: 350, 6: 145, 7: 70, 8: 40, 9: 100 };

export function jobFamily(code) {
  const c = String(code || "");
  const [key, label] = FAMILY[c.slice(0, 2)] || ["job", "Other"];
  return { key, label, hue: HUE[c[0]] ?? 255 };
}

/** <span class="job-ic"> with the family icon; decorative unless `labelled` (then it carries the family name). */
export function jobIcon(code, { size = 40, labelled = false } = {}) {
  const f = jobFamily(code);
  const el = document.createElement("span");
  el.className = "job-ic";
  el.style.setProperty("--h", f.hue);
  el.style.setProperty("--s", `${size}px`);
  el.dataset.family = f.key;
  if (labelled) { el.setAttribute("role", "img"); el.setAttribute("aria-label", f.label); el.title = f.label; }
  else el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${P[f.key]}"/></svg>`;
  return el;
}

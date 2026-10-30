// A small PDF writer for reports built in the browser: A4 pages, Helvetica (built into every PDF reader, so nothing is
// embedded), headings, short text, and simple diagrams (stat tiles, bar charts, a phase timeline, a week grid, chips)
// drawn as vector shapes. Text stays selectable and searchable.
// ponytail: Helvetica speaks WinAnsi (Latin-1 plus curly quotes and dashes); other characters print as "?". Embed a
// TrueType font if reports ever need other scripts.

const W = 595, H = 842, M = 48;  // A4 in points, margin
const WIN = { "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "…": 0x85, "€": 0x80 };
const SWAP = { "→": "->", "←": "<-", "✓": "v", "≥": ">=", "≤": "<=", "−": "-", " ": " " };
/** "#3b5bdb" -> "0.231 0.357 0.859", the PDF colour operand. */
export const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");
const C = { blue: rgb("#3b5bdb"), soft: rgb("#c9d4fa"), ink: rgb("#1e2230"), muted: rgb("#6b7280"), rule: rgb("#e3e6ee"), sunken: rgb("#f3f5f9"), white: "1 1 1" };

/** One byte per character: WinAnsi codes, PDF string escapes. */
const enc = (s) => [...String(s).replace(/[→←✓≥≤− ]/g, (c) => SWAP[c])].map((c) => {
  const code = c.charCodeAt(0), b = WIN[c] ?? (code < 128 || (code >= 160 && code < 256) ? code : 63);
  return b === 40 || b === 41 || b === 92 ? "\\" + c : String.fromCharCode(b);
}).join("");

let ctx;
const width = (text, size, bold) => {  // Arial shares Helvetica's metrics, close enough to place text
  ctx ??= document.createElement("canvas").getContext("2d");
  ctx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(String(text)).width;
};
/** Cut text to fit a width, ending with an ellipsis. */
const fit = (s, size, bold, max) => {
  s = String(s ?? "");
  if (width(s, size, bold) <= max) return s;
  while (s.length > 1 && width(s + "…", size, bold) > max) s = s.slice(0, -1);
  return s.trimEnd() + "…";
};
/** Wrap words into lines no wider than max. */
const wrap = (s, size, bold, max) => String(s ?? "").split(/\n+/).flatMap((para) => {
  const out = [];
  let cur = "";
  for (const word of para.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (width(next, size, bold) <= max || !cur) cur = next; else { out.push(cur); cur = word; }
  }
  return cur ? [...out, cur] : out;
});

export function pdfDoc(title) {
  const pages = [];
  let ops, y;  // y: the top of the free space, in PDF points from the bottom
  const page = () => { ops = []; pages.push(ops); y = H - M; };
  const room = (h) => { if (y - h < M + 20) page(); };
  /** Reserve h points of height and return their top edge. */
  const take = (h) => { room(h); const top = y; y -= h; return top; };
  const text = (x, base, size, bold, color, s, align = "left") => {
    const dx = align === "right" ? -width(s, size, bold) : align === "center" ? -width(s, size, bold) / 2 : 0;
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg ${(x + dx).toFixed(1)} ${base.toFixed(1)} Td (${enc(s)}) Tj ET`);
  };
  /** A rectangle given by its top-left corner, with rounded corners when r > 0. */
  const rect = (x, top, w, h, color, r = 0) => {
    const b = top - h;
    if (!r) { ops.push(`${color} rg ${x.toFixed(1)} ${b.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`); return; }
    r = Math.min(r, w / 2, h / 2);
    const k = r * 0.5523, R = x + w, T = top;
    ops.push(`${color} rg ${x + r} ${b} m ${R - r} ${b} l ${R - r + k} ${b} ${R} ${b + r - k} ${R} ${b + r} c ${R} ${T - r} l ${R} ${T - r + k} ${R - r + k} ${T} ${R - r} ${T} c `
      + `${x + r} ${T} l ${x + r - k} ${T} ${x} ${T - r + k} ${x} ${T - r} c ${x} ${b + r} l ${x} ${b + r - k} ${x + r - k} ${b} ${x + r} ${b} c f`);
  };
  const block = (s, { size = 11, bold = false, color = C.ink, indent = 0, gap = 6, lead = 1.45 } = {}) => {
    wrap(s, size, bold, W - 2 * M - indent).forEach((line) => { const top = take(size * lead); text(M + indent, top - size, size, bold, color, line); });
    y -= gap;
  };
  page();
  const doc = {
    /** The first page's title band. */
    cover(heading, sub) {
      rect(0, H, W, 168, C.blue);
      wrap(heading, 26, true, W - 2 * M).slice(0, 2).forEach((line, i) => text(M, H - 72 - i * 30, 26, true, C.white, line));
      text(M, H - 140, 11, false, rgb("#dfe6ff"), sub);
      y = H - 168 - 28;
      return doc;
    },
    /** A section heading; it starts a new page unless samePage (a short section that fits under the previous one). */
    h2(s, samePage = false) { if (ops.length && !samePage) page(); else if (samePage) { room(160); y -= 18; } block(s, { size: 22, bold: true, color: C.blue, gap: 4 }); return doc; },
    /** One plain sentence under a heading, saying what the diagram shows. */
    lede(s) { if (s) block(s, { size: 10.5, color: C.muted, gap: 14 }); return doc; },
    h3(s) { room(70); y -= 8; block(s, { size: 13, bold: true, gap: 6 }); return doc; },
    p(s, muted = false) { if (s) block(s, { color: muted ? C.muted : C.ink }); return doc; },
    /** Up to four figures side by side: [value, label]. */
    tiles(items) {
      const n = items.length, gap = 10, w = (W - 2 * M - gap * (n - 1)) / n, top = take(74);
      items.forEach(([value, label], i) => {
        const x = M + i * (w + gap);
        rect(x, top, w, 64, C.sunken, 10);
        text(x + 14, top - 32, 20, true, C.blue, fit(value, 20, true, w - 24));
        text(x + 14, top - 50, 9.5, false, C.muted, fit(label, 9.5, false, w - 24));
      });
      y -= 10;
      return doc;
    },
    /** A labelled progress bar (0..1). */
    meter(label, share, note) {
      const top = take(34), w = W - 2 * M;
      text(M, top - 10, 10, true, C.ink, label); text(M + w, top - 10, 10, false, C.muted, note, "right");
      rect(M, top - 18, w, 8, C.rule, 4); if (share > 0) rect(M, top - 18, Math.max(8, w * Math.min(1, share)), 8, C.blue, 4);
      return doc;
    },
    /** Horizontal bars on a 0..max scale. rows: {label, now, need}; the pale bar is the target, the blue bar today. */
    gapBars(rows, max = 5) {
      const lw = 190, bx = M + lw, bw = W - 2 * M - lw - 54;
      const legend = take(22);
      rect(bx, legend - 4, 10, 10, C.blue, 2); text(bx + 14, legend - 13, 9, false, C.muted, "Your level now");
      rect(bx + 110, legend - 4, 10, 10, C.soft, 2); text(bx + 124, legend - 13, 9, false, C.muted, "Level the job needs");
      rows.forEach((r) => {
        const top = take(22);
        text(M, top - 14, 9.5, false, C.ink, fit(r.label, 9.5, false, lw - 10));
        rect(bx, top - 6, bw, 10, C.sunken, 5);
        rect(bx, top - 6, Math.max(10, bw * r.need / max), 10, C.soft, 5);
        if (r.now > 0) rect(bx, top - 6, Math.max(10, bw * r.now / max), 10, C.blue, 5);
        text(W - M, top - 14, 9.5, true, C.ink, `${r.now} to ${r.need}`, "right");
      });
      y -= 8;
      return doc;
    },
    /** Three phase columns: {title, sub, hours, items[]}, hours drawn as a bar against the largest phase. */
    phases(cols) {
      const gap = 10, w = (W - 2 * M - gap * (cols.length - 1)) / cols.length, most = Math.max(1, ...cols.map((c) => c.hours));
      const lines = cols.map((c) => c.items.slice(0, 6).flatMap((s) => wrap(s, 9, false, w - 34).slice(0, 2).map((t, k) => [t, k === 0])));
      const top = take(118 + Math.max(...lines.map((l) => l.length)) * 15);
      cols.forEach((c, i) => {
        const x = M + i * (w + gap);
        rect(x, top, w, 118 + lines[i].length * 15 + 6, C.sunken, 12);
        rect(x, top, w, 46, C.blue, 12); rect(x, top - 30, w, 16, C.blue);
        text(x + 12, top - 20, 11.5, true, C.white, fit(c.title, 11.5, true, w - 24));
        text(x + 12, top - 36, 9, false, rgb("#dfe6ff"), fit(c.sub, 9, false, w - 24));
        text(x + 12, top - 70, 18, true, C.blue, `${c.hours} h`);
        rect(x + 12, top - 80, w - 24, 6, C.rule, 3); rect(x + 12, top - 80, Math.max(6, (w - 24) * c.hours / most), 6, C.blue, 3);
        lines[i].forEach(([s, first], j) => {
          if (first) rect(x + 12, top - 101 - j * 15, 4, 4, C.blue, 2);
          text(x + 22, top - 104 - j * 15, 9, false, C.ink, fit(s, 9, false, w - 34));
        });
      });
      y -= 12;
      return doc;
    },
    /** Weeks as rows of step squares. rows: {label, title, steps: [{kind, done}]}; kinds share one colour each. */
    weekGrid(rows, kinds) {
      const legend = take(22);
      Object.entries(kinds).forEach(([, [name, hex]], i) => { rect(M + i * 110, legend - 4, 10, 10, rgb(hex), 2); text(M + i * 110 + 14, legend - 13, 9, false, C.muted, name); });
      text(W - M, legend - 13, 9, false, C.muted, "Filled = done", "right");
      rows.forEach((r) => {
        const top = take(24);
        rect(M, top, W - 2 * M, 20, C.sunken, 6);
        text(M + 8, top - 14, 9.5, true, C.blue, r.label);
        r.steps.forEach((s, i) => {
          const [, hex] = kinds[s.kind] || kinds.learn, x = M + 52 + i * 18;
          rect(x, top - 4, 12, 12, s.done ? rgb(hex) : C.white, 3);
          if (!s.done) ops.push(`${rgb(hex)} RG 1.2 w ${x + 0.6} ${top - 15.4} 10.8 10.8 re S`);
        });
        text(M + 52 + Math.max(3, r.steps.length) * 18 + 6, top - 14, 9.5, false, C.ink, fit(r.title, 9.5, false, W - 2 * M - 120));
      });
      y -= 8;
      return doc;
    },
    /** Rounded labels that wrap across lines: [{text, color, ink}]. */
    chips(items) {
      let x = M, top = take(26);
      items.forEach(({ text: s, color = C.soft, ink = C.blue }) => {
        const w = Math.min(W - 2 * M, width(s, 9.5, true) + 20);
        if (x + w > W - M) { x = M; top = take(26); }
        rect(x, top, w, 20, color, 10);
        text(x + 10, top - 13.5, 9.5, true, ink, fit(s, 9.5, true, w - 20));
        x += w + 6;
      });
      y -= 8;
      return doc;
    },
    /** A vertical timeline: [{when, what}]. */
    timeline(items) {
      items.forEach((e, i) => {
        const top = take(34);
        if (i < items.length - 1) rect(M + 5, top - 10, 2, 34, C.rule);
        rect(M, top - 4, 12, 12, C.blue, 6);
        text(M + 22, top - 13, 10, true, C.ink, e.what);
        text(M + 22, top - 26, 9, false, C.muted, e.when);
      });
      return doc;
    },
    /** The finished file: catalog, page tree, two fonts, one content stream per page (page numbers added here). */
    blob() {
      const objs = [];
      const add = (s) => objs.push(s);
      add("<< /Type /Catalog /Pages 2 0 R >>");
      add("");  // page tree, filled in once the page objects have numbers
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      const kids = pages.map((list, i) => {
        const body = [...list, `BT /F1 8.5 Tf ${C.muted} rg ${M} 26 Td (${enc(title)}) Tj ET`,
          `BT /F1 8.5 Tf ${C.muted} rg ${W - M - width(`${i + 1} / ${pages.length}`, 8.5)} 26 Td (${enc(`${i + 1} / ${pages.length}`)}) Tj ET`].join("\n");
        add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
        add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objs.length} 0 R >>`);
        return `${objs.length} 0 R`;
      });
      objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
      add(`<< /Title (${enc(title)}) /Producer (AiversePulse) >>`);
      let out = "%PDF-1.4\n";
      const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return new Blob([Uint8Array.from(out, (c) => c.charCodeAt(0))], { type: "application/pdf" });
    },
  };
  return doc;
}

/** Save a Blob as a file. */
export function saveFile(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

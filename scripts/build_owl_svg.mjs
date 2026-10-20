// Writes the static owl (favicon / docs) from the same artwork the app animates.
//   node scripts/build_owl_svg.mjs
import { writeFileSync } from "node:fs";
import { owlSVG } from "../web/js/owl-art.js";

const svg = owlSVG("fav").replace('class="owl-svg" ', "").replace(' aria-hidden="true" focusable="false"', "");
writeFileSync(new URL("../web/owl/owl.svg", import.meta.url), svg);
console.log("web/owl/owl.svg", svg.length, "bytes");

// Live profile banner: takes the static banner in assets/ (same fonts, typing line and text on the left)
// and replaces the ecosystem illustration on the right with an orbit drawn from the activity data:
// one node per project (top 8 by commits in the last 30 days), sized by activity, pulsing when updated
// within 24 hours, lit within 7 days, dimmed when older, with light flowing from each node to the centre.
// Pure SVG + CSS (no script), so it animates inside GitHub's image proxy; all motion sits inside
// `prefers-reduced-motion: no-preference`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CX = 985;
const CY = 178;
const R = 100; // node ring
const HUB = 34; // centre disc
const MAX_NODES = 8;
const HOUR = 3_600_000;

const THEMES = {
  dark: {
    template: "assets/banner-dark.svg",
    accent: "#c6ef4e",
    ink: "#cbf25a",
    fg: "#ecede6",
    subtle: "#8a8f80",
    node: "#14170f",
    line: "rgba(236,237,230,0.22)",
    hubText: "#11130f",
  },
  light: {
    template: "assets/banner-light.svg",
    accent: "#c6ef4e",
    ink: "#3d6a0c",
    fg: "#11130f",
    subtle: "#5f6458",
    node: "#ffffff",
    line: "rgba(17,19,15,0.22)",
    hubText: "#11130f",
  },
};

// Geist Mono 500, printable ASCII + · … — (SIL OFL 1.1, see assets/fonts/README.md): labels and numbers.
const MONO = fs.readFileSync(path.join(ROOT, "assets/fonts/geist-mono-500-ascii.woff2")).toString("base64");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f = (n) => Number(n.toFixed(2));

/**
 * projects: [{ label, jumlah30, terakhir }] (already sorted, most active first)
 * summary:  { jumlah30, proyekAktif30 }
 */
export function buildBanner(theme, projects, summary, now = Date.now()) {
  const t = THEMES[theme];
  let svg = fs.readFileSync(path.join(ROOT, t.template), "utf8");
  const nodes = projects.slice(0, MAX_NODES);
  const max = Math.max(1, ...nodes.map((p) => p.jumlah30));

  const css = `
.lbl{font-family:"GM",ui-monospace,Menlo,Consolas,monospace;font-weight:500;font-size:11px;fill:${t.fg}}
.cnt{font-family:"GM",ui-monospace,Menlo,Consolas,monospace;font-weight:500;font-size:9.5px;fill:${t.subtle}}
.dim .lbl{fill:${t.subtle}}
.hubn{font-family:"GM",ui-monospace,Menlo,Consolas,monospace;font-weight:500;font-size:19px;fill:${t.hubText}}
.hubc{font-family:"GM",ui-monospace,Menlo,Consolas,monospace;font-weight:500;font-size:7.5px;letter-spacing:.3px;fill:${t.hubText}}
.spk{stroke:${t.ink};stroke-width:1.4;stroke-dasharray:3 7;stroke-linecap:round}
.spk.dim{opacity:.3}
.halo{fill:none;stroke:${t.ink};stroke-width:1.6;opacity:0}
.comet{transform-origin:${CX}px ${CY}px}
@media (prefers-reduced-motion: no-preference){
.spk.new{animation:flow .9s linear infinite}
.spk.lit{animation:flow 1.6s linear infinite}
.halo{animation:halo 2.2s cubic-bezier(.16,1,.3,1) infinite}
.comet{animation:spin 18s linear infinite}
}
@media (prefers-reduced-motion: reduce){.halo{opacity:.45;transform:scale(1.5)}}
@keyframes halo{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.3);opacity:0}}`;

  const parts = [];
  parts.push(`<circle class="orbit2" cx="${CX}" cy="${CY}" r="162"/>`);
  parts.push(`<circle class="orbit" cx="${CX}" cy="${CY}" r="${R}"/>`);
  parts.push(`<g class="comet"><circle cx="${CX}" cy="${CY - R}" r="2.6" fill="${t.ink}"/></g>`);

  const spokes = [];
  const dots = [];
  nodes.forEach((p, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const x = CX + ux * R;
    const y = CY + uy * R;
    const scale = Math.sqrt(p.jumlah30 / max);
    const r = 6 + 8 * scale;
    const age = now - Date.parse(p.terakhir);
    const state = age <= 24 * HOUR ? "new" : age <= 7 * 24 * HOUR ? "lit" : "dim";

    spokes.push(
      `<line class="spk ${state}" style="animation-delay:-${(i * 0.23).toFixed(2)}s" x1="${f(x - ux * (r + 3))}" y1="${f(y - uy * (r + 3))}" x2="${f(CX + ux * (HUB + 5))}" y2="${f(CY + uy * (HUB + 5))}"/>`,
    );

    const node = [];
    if (state === "new")
      node.push(`<circle class="halo" style="transform-origin:${f(x)}px ${f(y)}px;animation-delay:-${(i * 0.4).toFixed(1)}s" cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`);
    if (state === "dim")
      node.push(
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${t.node}" stroke="${t.line}" stroke-width="1.5"/><circle cx="${f(x)}" cy="${f(y)}" r="2.6" fill="${t.subtle}"/>`,
      );
    else
      node.push(
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${t.accent}" fill-opacity="${f(0.5 + 0.5 * scale)}" stroke="${t.ink}" stroke-width="1.5"/>`,
      );

    // Label outside the ring: anchored away from the centre, two lines (name, commits).
    const d = R + r + 9;
    const ax = CX + ux * d;
    const ay = CY + uy * d;
    const anchor = ux > 0.35 ? "start" : ux < -0.35 ? "end" : "middle";
    const [y1, y2] = uy < -0.5 ? [ay - 12, ay - 1] : uy > 0.5 ? [ay + 9, ay + 20] : [ay - 1, ay + 10];
    const unit = p.jumlah30 === 1 ? "commit" : "commits";
    node.push(
      `<text x="${f(ax)}" y="${f(y1)}" text-anchor="${anchor}" class="lbl">${esc(p.label)}</text>` +
        `<text x="${f(ax)}" y="${f(y2)}" text-anchor="${anchor}" class="cnt">${p.jumlah30} ${unit}</text>`,
    );
    dots.push(`<g class="${state}">${node.join("")}</g>`);
  });

  parts.push(...spokes);
  parts.push(`<circle class="pulse" cx="${CX}" cy="${CY}" r="${HUB}"/>`);
  parts.push(...dots);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${HUB}" fill="${t.accent}"/>`);
  parts.push(`<text x="${CX}" y="${CY + 2}" text-anchor="middle" class="hubn">${summary.jumlah30}</text>`);
  parts.push(`<text x="${CX}" y="${CY + 13}" text-anchor="middle" class="hubc">COMMITS</text>`);
  parts.push(`<text x="${CX}" y="${CY + 22}" text-anchor="middle" class="hubc">30 DAYS</text>`);

  const block = `    <!-- commit activity: projects worked on in the last 30 days (generated hourly) -->\n    ${parts.join("\n    ")}\n\n`;

  const before = svg;
  svg = svg
    .replace(/(@font-face\{font-family:"GM";font-weight:500;src:url\(data:font\/woff2;base64,)[^)]+\)/, `$1${MONO})`)
    .replace(/\n {4}<\/style>/, `${css}\n    </style>`)
    .replace(/ {4}<!-- ecosystem[\s\S]*?(?= {4}<!-- text -->)/, block)
    .replace(
      "</desc>",
      ` Commit activity: ${summary.jumlah30} commits in the last 30 days across ${summary.proyekAktif30} projects.</desc>`,
    );
  if (svg === before || !svg.includes("commit activity:") || !svg.includes(MONO.slice(0, 40)))
    throw new Error(`banner template ${t.template} has an unexpected structure`);
  return svg;
}

// Builds a "Languages" card (light + dark SVG) from the owner's public, non-fork repositories.
// Each repository counts equally, so one large vendored codebase does not dominate the picture.
// Works with the built-in GITHUB_TOKEN (public REST data only). No dependencies.
//
// usage: node scripts/languages-card.mjs <owner> <outDir>
import fs from "node:fs";
import path from "node:path";

const [owner = process.env.GITHUB_REPOSITORY_OWNER, outDir = "dist/metrics"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;

// Build tooling and generated platform code that says little about what the owner writes.
const IGNORED = new Set(["makefile", "shell", "dockerfile", "cmake", "c", "c++", "swift", "kotlin", "objective-c", "batchfile", "powershell", "procfile", "html", "css"]);
const COLORS = {
  Python: "#3572A5", PHP: "#4F5D95", Blade: "#f7523f", Java: "#b07219", Dart: "#00B4AB", "Jupyter Notebook": "#DA5B0B",
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Vue: "#41b883", Go: "#00ADD8", Rust: "#dea584", "C#": "#178600",
};
const MAX_ROWS = 6;

async function gh(url) {
  const res = await fetch(`https://api.github.com${url}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "profile-languages-card", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

const repos = (await gh(`/users/${owner}/repos?per_page=100&type=owner`)).filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== owner.toLowerCase());
const totals = {};
let counted = 0;
for (const r of repos) {
  const langs = Object.entries(await gh(`/repos/${owner}/${r.name}/languages`)).filter(([name]) => !IGNORED.has(name.toLowerCase()));
  const sum = langs.reduce((a, [, b]) => a + b, 0);
  if (!sum) continue;
  counted++;
  for (const [name, bytes] of langs) totals[name] = (totals[name] || 0) + bytes / sum;
}
if (!counted) throw new Error("no language data");

let rows = Object.entries(totals).map(([name, w]) => ({ name, share: w / counted })).sort((a, b) => b.share - a.share);
if (rows.length > MAX_ROWS) {
  const rest = rows.slice(MAX_ROWS - 1).reduce((a, r) => a + r.share, 0);
  rows = [...rows.slice(0, MAX_ROWS - 1), { name: "Other", share: rest }];
}

const THEMES = {
  light: { fg: "#11130f", muted: "#555a4f", track: "#ecebe4", other: "#9aa08f" },
  dark: { fg: "#ecede6", muted: "#a3a898", track: "#1c2016", other: "#6b7062" },
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function card(t) {
  const W = 480, X = 20, BAR_Y = 70, BAR_W = W - 2 * X;
  const H = 98 + Math.ceil(rows.length / 2) * 26 + 12;
  let x = X;
  const segs = rows.map((r) => {
    const w = Math.max(r.share * BAR_W, 2);
    const s = `<rect x="${x.toFixed(2)}" y="${BAR_Y}" width="${w.toFixed(2)}" height="10" fill="${r.name === "Other" ? t.other : COLORS[r.name] || t.other}"/>`;
    x += w;
    return s;
  }).join("");
  const legend = rows.map((r, i) => {
    const cx = X + (i % 2) * (BAR_W / 2), cy = 112 + Math.floor(i / 2) * 26;
    return `<g transform="translate(${cx} ${cy})"><circle cx="5" cy="-4" r="5" fill="${r.name === "Other" ? t.other : COLORS[r.name] || t.other}"/><text x="18" y="0" class="n">${esc(r.name)}</text><text x="${BAR_W / 2 - 16}" y="0" class="p" text-anchor="end">${pct(r.share)}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Languages</title>
<desc id="d">${esc(rows.map((r) => `${r.name} ${pct(r.share)}`).join(", "))}; ${counted} public repositories, each weighted equally.</desc>
<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.h{font-size:16px;font-weight:600;fill:${t.fg}}
.s{font-size:12px;fill:${t.muted}}
.n{font-size:13px;fill:${t.fg}}
.p{font-size:12px;fill:${t.muted};font-variant-numeric:tabular-nums}
.grow{transform-origin:${X}px ${BAR_Y}px;animation:grow 1.2s cubic-bezier(.16,1,.3,1) both}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media (prefers-reduced-motion: reduce){.grow{animation:none}}
</style>
<text x="${X}" y="32" class="h">Languages</text>
<text x="${X}" y="52" class="s">Across ${counted} public repositories, each weighted equally</text>
<clipPath id="bar"><rect x="${X}" y="${BAR_Y}" width="${BAR_W}" height="10" rx="5"/></clipPath>
<rect x="${X}" y="${BAR_Y}" width="${BAR_W}" height="10" rx="5" fill="${t.track}"/>
<g clip-path="url(#bar)"><g class="grow">${segs}</g></g>
${legend}
</svg>
`;
}

fs.mkdirSync(outDir, { recursive: true });
for (const [name, t] of Object.entries(THEMES)) {
  const file = path.join(outDir, name === "light" ? "languages.svg" : "languages-dark.svg");
  fs.writeFileSync(file, card(t));
  console.log(`wrote ${file}`);
}
console.log(rows.map((r) => `${r.name} ${pct(r.share)}`).join(" | "));

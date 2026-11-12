// Builds the public activity data used by the portfolio (rzkydell.vercel.app):
//   aktivitas-commit.json  commits per project in the last 30 days / this year (the "orbit" graphic)
//   github-profil.json     public profile numbers, top languages and the GitHub contribution calendar
//   banner-dark.svg,       the profile README banner with a live commit-activity orbit
//   banner-light.svg       (see activity-banner.mjs)
//
// Commits are counted straight from the REST API on each repository's default branch, so private
// company repositories count as soon as they are pushed. Only dates and counts are read; commit
// messages are never fetched or stored.
//
// Environment:
//   GH_STATS_TOKEN  classic token of the profile owner (scopes: repo, read:user). Without it the script
//                   exits quietly and writes nothing.
//   REPO_MAP        optional JSON, kept as a repository secret so private repository names never appear
//                   in this public repository:
//                   { "emails": ["..."],                       commit author emails that belong to the owner
//                     "repos": { "owner/name": "iam", ... },   repository -> display id (several may share one)
//                     "extra": ["owner/name", ...],            repositories outside the token's own list
//                     "kinra": ["owner", ...],                 accounts whose unmapped private repos count as company work
//                     "tampil": { "id": { "jenis", "nama": {id,en}, "singkat": {id,en} } } }  optional overrides
//
// usage: node scripts/activity-data.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import { buildBanner } from "./activity-banner.mjs";

const outDir = process.argv[2] || "dist";
const token = process.env.GH_STATS_TOKEN;
if (!token) {
  console.log("GH_STATS_TOKEN is not set; activity data was not refreshed.");
  process.exit(0);
}
let map;
try {
  map = JSON.parse(process.env.REPO_MAP || "{}");
} catch {
  throw new Error("REPO_MAP is not valid JSON");
}

const DAY = 86_400_000;
const WIB = 7 * 3_600_000; // Asia/Jakarta, no DST
const MAX_NODES = 10;
const CALENDAR_WEEKS = 26;
const now = Date.now();
const since30 = now - 30 * DAY;
const yearStart = Date.UTC(new Date(now + WIB).getUTCFullYear(), 0, 1) - WIB;
const since = Math.min(since30, yearStart);

const n = (id, en = id) => ({ id, en });
// Public product names (they already appear on the portfolio). Repository names live only in REPO_MAP.
const KNOWN = {
  iam: { jenis: "kinra", nama: n("IAM — Manajemen Identitas", "IAM — Identity Management"), singkat: n("IAM") },
  onesei: { jenis: "kinra", nama: n("OneSeiMangkei (SSO)"), singkat: n("OneSeiMangkei") },
  aduan: { jenis: "kinra", nama: n("Portal Aduan TI", "IT Helpdesk Portal"), singkat: n("Portal Aduan", "IT Helpdesk") },
  mke: { jenis: "kinra", nama: n("Dashboard MKE", "MKE Dashboard"), singkat: n("Dashboard MKE", "MKE Dashboard") },
  sekper: { jenis: "kinra", nama: n("Dashboard Sekretariat", "Secretariat Dashboard"), singkat: n("Sekretariat", "Secretariat") },
  eoffice: { jenis: "kinra", nama: n("E-Office"), singkat: n("E-Office") },
  ekspedisi: { jenis: "kinra", nama: n("Ekspedisi Berkas", "Document Dispatch"), singkat: n("Ekspedisi", "Dispatch") },
  uat: { jenis: "kinra", nama: n("UAT TI", "IT UAT Tool"), singkat: n("UAT TI", "UAT Tool") },
  website: {
    jenis: "kinra",
    nama: n("Website & CMS KEK Sei Mangkei", "Sei Mangkei SEZ Website & CMS"),
    singkat: n("Website & CMS"),
  },
  survei: { jenis: "kinra", nama: n("Survei Kepuasan Layanan", "Service Satisfaction Survey"), singkat: n("Survei", "Survey") },
  portofolio: { jenis: "pribadi", nama: n("Portofolio ini", "This portfolio"), singkat: n("Portofolio", "Portfolio") },
  profil: { jenis: "pribadi", nama: n("Profil GitHub", "GitHub profile"), singkat: n("Profil GitHub", "GitHub profile") },
  ...map.tampil,
};
// Short English labels for the banner orbit (REPO_MAP "tampil".<id>.banner overrides).
const BANNER_LABELS = {
  iam: "IAM",
  onesei: "OneSei SSO",
  aduan: "Helpdesk",
  mke: "MKE",
  sekper: "Secretariat",
  eoffice: "E-Office",
  ekspedisi: "Dispatch",
  uat: "UAT",
  website: "Web & CMS",
  survei: "Survey",
  portofolio: "Portfolio",
  profil: "Profile",
};
const REPOS = Object.fromEntries(Object.entries(map.repos || {}).map(([k, v]) => [k.toLowerCase(), v]));
const EMAILS = new Set((map.emails || []).map((e) => e.toLowerCase()));
const COMPANY_OWNERS = new Set((map.kinra || []).map((o) => o.toLowerCase()));

// Same filtering as the languages card: every repository weighs the same; build tooling is ignored.
const IGNORED_LANGS = new Set(
  ["makefile", "shell", "dockerfile", "cmake", "c", "c++", "swift", "kotlin", "objective-c", "batchfile", "powershell", "procfile", "html", "css"],
);

async function gh(url, init = {}) {
  const res = await fetch(url.startsWith("http") ? url : `https://api.github.com${url}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "rzkydell-activity-data",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${url.split("?")[0].replace(/\/repos\/[^/]+\/[^/]+/, "/repos/…")} -> ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- commits per repository
const me = await gh("/user");
const login = me.login;
const repos = [];
for (let page = 1; page <= 10; page++) {
  const batch = await gh(`/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`);
  repos.push(...batch);
  if (batch.length < 100) break;
}
for (const full of map.extra || []) {
  if (repos.some((r) => r.full_name.toLowerCase() === full.toLowerCase())) continue;
  try {
    repos.push(await gh(`/repos/${full}`));
  } catch {
    // no access (any more): skip quietly, the name must not end up in the logs
  }
}

const isOwner = (c) =>
  c.author?.login?.toLowerCase() === login.toLowerCase() || EMAILS.has(String(c.commit?.author?.email).toLowerCase());

const stats = [];
for (const r of repos) {
  if (r.fork && !REPOS[r.full_name.toLowerCase()]) continue;
  if (!r.pushed_at || Date.parse(r.pushed_at) < since) continue;
  const dates = [];
  for (let page = 1; page <= 20; page++) {
    let batch;
    try {
      batch = await gh(
        `/repos/${r.full_name}/commits?sha=${encodeURIComponent(r.default_branch)}&since=${new Date(since).toISOString()}&per_page=100&page=${page}`,
      );
    } catch {
      break; // empty repository (409) or lost access
    }
    for (const c of batch) if (isOwner(c)) dates.push(c.commit.author.date);
    if (batch.length < 100) break;
  }
  if (!dates.length) continue;
  const t = dates.map(Date.parse);
  stats.push({
    repo: r.full_name,
    privat: r.private,
    url: r.private ? null : r.html_url,
    terakhir: new Date(Math.max(...t)).toISOString(),
    jumlah30: t.filter((x) => x >= since30).length,
    jumlahTahun: t.filter((x) => x >= yearStart).length,
  });
}

// ---------------------------------------------------------------- public project list
const tidy = (name) => {
  const s = name
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const short = (s, max = 18) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max).replace(/\s+\S*$/, "");
  return `${cut || s.slice(0, max - 1)}…`;
};
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const byId = new Map();
let privateNo = 0;
for (const s of stats.sort((a, b) => a.repo.localeCompare(b.repo))) {
  const key = s.repo.toLowerCase();
  const id = REPOS[key];
  let base;
  if (id && KNOWN[id]) base = { id, ...KNOWN[id], url: s.privat ? null : s.url };
  else if (!s.privat) {
    const [owner, name] = s.repo.split("/");
    const shown = tidy(name);
    base = {
      id: slug(owner.toLowerCase() === login.toLowerCase() ? name : s.repo),
      jenis: "pribadi",
      nama: n(shown),
      singkat: n(short(shown)),
      url: s.url,
    };
  } else {
    // Private repository without a mapping: shown without its name or link.
    const company = COMPANY_OWNERS.has(key.split("/")[0]);
    base = {
      id: `privat-${++privateNo}`,
      jenis: company ? "kinra" : "pribadi",
      nama: company ? n("Proyek privat KINRA", "Private KINRA project") : n("Proyek privat", "Private project"),
      singkat: n("Privat", "Private"),
      url: null,
    };
  }
  const prev = byId.get(base.id);
  if (prev) {
    if (Date.parse(s.terakhir) > Date.parse(prev.terakhir)) prev.terakhir = s.terakhir;
    prev.jumlah30 += s.jumlah30;
    prev.jumlahTahun += s.jumlahTahun;
  } else byId.set(base.id, { ...base, terakhir: s.terakhir, jumlah30: s.jumlah30, jumlahTahun: s.jumlahTahun });
}
const all = [...byId.values()].sort(
  (a, b) => b.jumlah30 - a.jumlah30 || Date.parse(b.terakhir) - Date.parse(a.terakhir),
);
const shownProjects = all.slice(0, MAX_NODES);
const rest = all.slice(MAX_NODES);
const activity = {
  ringkasan: {
    tahun: new Date(now + WIB).getUTCFullYear(),
    jumlah30: all.reduce((a, p) => a + p.jumlah30, 0),
    tahunIni: all.reduce((a, p) => a + p.jumlahTahun, 0),
    proyekAktif30: all.filter((p) => p.jumlah30 > 0).length,
  },
  proyek: shownProjects.map(({ id, nama, singkat, jenis, url, terakhir, jumlah30 }) => ({
    id,
    nama,
    singkat,
    jenis,
    url,
    terakhir,
    jumlah30,
  })),
  lainnya: { jumlah: rest.length, jumlah30: rest.reduce((a, p) => a + p.jumlah30, 0) },
};

// ---------------------------------------------------------------- profile + GitHub contribution calendar
const QUERY = `query ($from: DateTime!) {
  viewer {
    login name avatarUrl(size: 120)
    publik: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
    langs: repositories(privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false, first: 100) {
      nodes { name isArchived languages(first: 20, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } } }
    }
    contributionsCollection(from: $from) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`;
const gql = await gh("https://api.github.com/graphql", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY, variables: { from: new Date(now - (CALENDAR_WEEKS * 7 + 7) * DAY).toISOString() } }),
});
if (gql.errors?.length) throw new Error(`GraphQL: ${gql.errors.map((e) => e.message).join("; ")}`);
const v = gql.data.viewer;

const colors = {};
const totals = {};
let counted = 0;
for (const r of v.langs.nodes) {
  if (r.isArchived || r.name.toLowerCase() === v.login.toLowerCase()) continue;
  const langs = r.languages.edges.filter((e) => !IGNORED_LANGS.has(e.node.name.toLowerCase()));
  const sum = langs.reduce((a, e) => a + e.size, 0);
  if (!sum) continue;
  counted++;
  for (const e of langs) {
    totals[e.node.name] = (totals[e.node.name] || 0) + e.size / sum;
    if (e.node.color) colors[e.node.name] = e.node.color;
  }
}
const ranked = Object.entries(totals)
  .map(([name, w]) => ({ name, share: w / Math.max(1, counted) }))
  .sort((a, b) => b.share - a.share);
const round = (x) => Math.round(x * 1000) / 10;
const languages = ranked.slice(0, 4).map((r) => ({ nama: r.name, persen: round(r.share), warna: colors[r.name] || null }));
const other = ranked.slice(4).reduce((a, r) => a + r.share, 0);
if (other > 0.005) languages.push({ nama: "Lainnya", persen: round(other), warna: null });

const perDay = new Map(
  v.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => [d.date, d.contributionCount])),
);
const today = new Date(`${new Date(now + WIB).toISOString().slice(0, 10)}T00:00:00Z`);
const start = new Date(today.getTime() - (today.getUTCDay() + (CALENDAR_WEEKS - 1) * 7) * DAY);
const days = [];
for (let t = start.getTime(); t <= today.getTime(); t += DAY) days.push(perDay.get(new Date(t).toISOString().slice(0, 10)) || 0);
const profile = {
  login: v.login,
  nama: v.name || v.login,
  avatar: v.avatarUrl,
  repoPublik: v.publik.totalCount,
  bahasa: languages,
  kalender: { mulai: start.toISOString().slice(0, 10), hari: days, total: days.reduce((a, b) => a + b, 0) },
};

// ---------------------------------------------------------------- write only when the content changed
fs.mkdirSync(outDir, { recursive: true });
function write(file, data) {
  const target = path.join(outDir, file);
  try {
    const old = JSON.parse(fs.readFileSync(target, "utf8"));
    delete old.diperbarui;
    if (JSON.stringify(old) === JSON.stringify(data)) return false;
  } catch {}
  const text = JSON.stringify({ diperbarui: new Date(now).toISOString(), ...data }, null, 2).replace(
    /\[\s*(\d[\d,\s]*?)\s*\]/g,
    (_, nums) => `[${nums.replace(/\s+/g, "")}]`,
  );
  fs.writeFileSync(target, `${text}\n`);
  return true;
}
const a = write("aktivitas-commit.json", activity);
const p = write("github-profil.json", profile);

// ---------------------------------------------------------------- live profile banner (dark + light)
const bannerProjects = all
  .filter((x) => x.jumlah30 > 0)
  .map((x) => ({
    label: map.tampil?.[x.id]?.banner ?? BANNER_LABELS[x.id] ?? short(x.singkat.en, 11),
    jumlah30: x.jumlah30,
    terakhir: x.terakhir,
  }));
const banners = ["dark", "light"].map((theme) => {
  const target = path.join(outDir, `banner-${theme}.svg`);
  const svg = buildBanner(theme, bannerProjects, activity.ringkasan, now);
  let old = null;
  try {
    old = fs.readFileSync(target, "utf8");
  } catch {}
  if (old === svg) return false;
  fs.writeFileSync(target, svg);
  return true;
});

console.log(
  `aktivitas-commit.json ${a ? "updated" : "unchanged"}: ${activity.proyek.length} nodes, ` +
    `${activity.ringkasan.jumlah30} commits in 30 days, ${activity.ringkasan.tahunIni} this year; ` +
    `github-profil.json ${p ? "updated" : "unchanged"}: ${profile.kalender.total} contributions in ${CALENDAR_WEEKS} weeks; ` +
    `banners ${banners.some(Boolean) ? "updated" : "unchanged"}.`,
);

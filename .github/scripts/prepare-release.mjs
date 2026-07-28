#!/usr/bin/env node
// Determina se serve una nuova release analizzando i commit dall'ultimo tag
// vX.Y.Z, bumpa in lockstep client/server/electron/package.json, aggiorna
// CHANGELOG.md, poi committa e taggga. Pensato per girare in CI (job
// "version" di .github/workflows/release.yml) ma è un normale script Node,
// eseguibile anche a mano per debug.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const pkgPaths = ['client', 'server', 'electron'].map((d) => path.join(repoRoot, d, 'package.json'));

const REPO = 'riftbane/orabridge';
const REBUILD_ONLY = process.env.REBUILD_ONLY === 'true';

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit' });
}

function capture(cmd) {
  return execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(pkgPaths[2], 'utf8'));
  return pkg.version;
}

function setOutputs(obj) {
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
  console.log('output:', obj);
}

function configureGitIdentity() {
  run('git config user.name "github-actions[bot]"');
  run('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
}

function tagExists(tag) {
  const local = capture(`git tag --list "${tag}"`);
  if (local) return true;
  try {
    const remote = capture(`git ls-remote --tags origin "refs/tags/${tag}"`);
    return Boolean(remote);
  } catch {
    return false;
  }
}

// electron-builder crea la GitHub Release "al volo" durante la pubblicazione
// e, per un tag nuovo, lo fa da più punti interni con config leggermente
// diverse tra loro: se nessuna release esiste ancora, due chiamate quasi
// simultanee possono ciascuna decidere "non esiste, la creo" e finire per
// creare DUE release duplicate per lo stesso tag, con gli asset (exe,
// blockmap, latest.yml) sparsi in modo incoerente tra le due. Precreando qui
// la release (vuota, senza asset) subito dopo il push del tag, ogni chiamata
// di electron-builder la trova già esistente e vi carica solo gli asset
// sopra, senza race.
function ensureGithubRelease(tag) {
  try {
    execSync(`gh release view ${tag} --repo ${REPO}`, { cwd: repoRoot, stdio: 'ignore' });
    console.log(`Release ${tag} già presente su GitHub, riuso.`);
  } catch {
    run(
      `gh release create ${tag} --repo ${REPO} --title ${tag} --verify-tag ` +
        `--notes "Release in preparazione: l'installer viene caricato a build completata."`
    );
  }
}

function writeVersion(version) {
  for (const p of pkgPaths) {
    const content = fs.readFileSync(p, 'utf8');
    const updated = content.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
    fs.writeFileSync(p, updated);
  }
}

function insertChangelogEntry(version, entries) {
  const date = new Date().toISOString().slice(0, 10);
  // Oggetto e corpo del commit su righe distinte, con il corpo rientrato
  // dentro il punto elenco: attaccati come erano prima ("…senza API key Nuova
  // piattaforma…") diventavano illeggibili, e le note della release finiscono
  // così come sono nella guida dell'app.
  const bullets = entries
    .map(
      ({ label, desc, body }) =>
        `- **${label}:** ${desc}${
          body
            ? `\n\n${body
                .split('\n')
                // Le righe vuote restano vuote: rientrarle lascerebbe spazi in coda.
                .map((l) => (l.trim() ? `  ${l}` : ''))
                .join('\n')}`
            : ''
        }`
    )
    .join('\n');
  const block = `## v${version} — ${date}\n\n${bullets}\n\n`;

  let changelog = fs.readFileSync(changelogPath, 'utf8');
  const idx = changelog.indexOf('\n## v');
  if (idx === -1) {
    changelog = changelog.replace(/\n*$/, '\n') + '\n' + block;
  } else {
    changelog = changelog.slice(0, idx + 1) + block + changelog.slice(idx + 1);
  }
  fs.writeFileSync(changelogPath, changelog);
}

// --- modalità "rebuild_only": nessun bump, ripubblica la versione corrente ---
if (REBUILD_ONLY) {
  const version = readVersion();
  const tag = `v${version}`;
  configureGitIdentity();
  if (!tagExists(tag)) {
    run(`git tag ${tag}`);
    run(`git push origin ${tag}`);
  } else {
    console.log(`Tag ${tag} già presente, riuso.`);
  }
  ensureGithubRelease(tag);
  setOutputs({ 'should-release': 'true', version, tag });
  process.exit(0);
}

// --- trova l'ultimo tag di release (ordinamento semver, non ancestry) ---
let lastTag = '';
try {
  const tags = capture('git tag --list "v*" --sort=-v:refname');
  lastTag = tags.split('\n').filter(Boolean)[0] || '';
} catch {
  lastTag = '';
}

// --- bootstrap: nessun tag esistente ancora nel repo ---
if (!lastTag) {
  const version = readVersion();
  const tag = `v${version}`;
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const hasEntry = changelog.includes(`## v${version} —`);

  configureGitIdentity();
  if (!hasEntry) {
    insertChangelogEntry(version, [
      { label: 'Nuovo', desc: `Prima release pubblicata automaticamente su GitHub Releases (${version}).`, body: '' },
    ]);
    run(`git add ${path.relative(repoRoot, changelogPath)}`);
    run(`git commit -m "chore(release): v${version} [skip ci]"`);
    run('git push origin HEAD:main');
  } else {
    console.log(`CHANGELOG.md ha già una voce per v${version}, non tocco nulla.`);
  }
  if (!tagExists(tag)) {
    run(`git tag ${tag}`);
    run(`git push origin ${tag}`);
  }
  ensureGithubRelease(tag);
  setOutputs({ 'should-release': 'true', version, tag });
  process.exit(0);
}

// --- release normale: analizza i commit da lastTag a HEAD ---
// %x1f/%x1e sono separatori ASCII unit/record: non compaiono mai in testo
// normale, quindi lo split e' sicuro anche con corpi di commit multilinea o
// contenenti ":" e virgole.
const UNIT_SEP = String.fromCharCode(0x1f);
const RECORD_SEP = String.fromCharCode(0x1e);
const raw = capture(`git log ${lastTag}..HEAD --pretty=format:%H%x1f%s%x1f%b%x1e`);
const commits = raw
  .split(RECORD_SEP)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [hash, subject = '', body = ''] = entry.split(UNIT_SEP);
    return { hash, subject: subject.trim(), body: body.trim() };
  });

const TYPE_LABELS = { feat: 'Nuovo', fix: 'Fix', perf: 'Migliorato' };
const RELEASE_TYPES = new Set(['feat', 'fix', 'perf']);
const CONVENTIONAL_RE = /^([a-zA-Z]+)(\([^)]*\))?(!)?:\s*(.+)$/;

let sawFeat = false;
let sawFixPerf = false;
let breaking = false;
const entries = [];

for (const c of commits) {
  const m = CONVENTIONAL_RE.exec(c.subject);
  if (!m) continue; // commit non convenzionale: ignorato ai fini della release
  const [, type, , bang, desc] = m;
  const isBreaking = Boolean(bang) || /BREAKING CHANGE:/.test(c.body);
  if (isBreaking) breaking = true;
  if (!RELEASE_TYPES.has(type) && !isBreaking) continue; // docs/chore/style/ecc. non rilasciano da soli

  if (type === 'feat') sawFeat = true;
  if (type === 'fix' || type === 'perf') sawFixPerf = true;

  const label = isBreaking ? '⚠ Cambiamento importante' : (TYPE_LABELS[type] || 'Modifica');
  const breakingNote = /BREAKING CHANGE:\s*([\s\S]*)/.exec(c.body);
  const body = isBreaking && breakingNote
    ? breakingNote[1].trim()
    : c.body.replace(/BREAKING CHANGE:[\s\S]*/, '').trim();
  entries.push({ label, desc, body });
}

let bump = null;
if (sawFeat) bump = 'minor';
else if (sawFixPerf) bump = 'patch';
if (breaking) bump = 'major';

if (!bump) {
  console.log(`Nessun commit rilevante da ${lastTag} a HEAD (feat/fix/perf/breaking): niente da rilasciare.`);
  setOutputs({ 'should-release': 'false' });
  process.exit(0);
}

function bumpSemver(version, type) {
  let [maj, min, pat] = version.split('.').map(Number);
  if (type === 'major') { maj += 1; min = 0; pat = 0; }
  else if (type === 'minor') { min += 1; pat = 0; }
  else { pat += 1; }
  return `${maj}.${min}.${pat}`;
}

const currentVersion = readVersion();
const version = bumpSemver(currentVersion, bump);
const tag = `v${version}`;

writeVersion(version);
insertChangelogEntry(version, entries);

configureGitIdentity();
run('git add client/package.json server/package.json electron/package.json CHANGELOG.md');
run(`git commit -m "chore(release): v${version} [skip ci]"`);
run(`git tag ${tag}`);
run('git push origin HEAD:main');
run(`git push origin ${tag}`);
ensureGithubRelease(tag);

setOutputs({ 'should-release': 'true', version, tag });

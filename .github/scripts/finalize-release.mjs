#!/usr/bin/env node
// Da eseguire in CI subito dopo che `electron-builder --publish always` ha
// creato con successo la GitHub Release per il tag vX.Y.Z (job "build" di
// .github/workflows/release.yml, runner windows-latest). Aggiunge al
// CHANGELOG.md la riga "- Build:" con il link all'installer pubblicato,
// committa quel cambiamento, e imposta le note della release su GitHub col
// testo della voce di changelog corrispondente.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'riftbane/orabridge';

const version = process.argv[2];
if (!version) {
  console.error('uso: finalize-release.mjs <version>');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit' });
}

const date = new Date().toISOString().slice(0, 10);
// electron-builder produce «Orabridge Setup 1.2.3.exe», ma GitHub sostituisce
// gli spazi con trattini nel nome dell'asset caricato: il link costruito sul
// nome locale rispondeva 404 in ogni voce del changelog.
const assetName = `Orabridge-Setup-${version}.exe`;
const releaseUrl = `https://github.com/${REPO}/releases/download/v${version}/${assetName}`;
const buildLine = `- Build: [\`${assetName}\`](${releaseUrl}) (${date}).`;

let changelog = fs.readFileSync(changelogPath, 'utf8');
const heading = `## v${version} — `;
const headingIdx = changelog.indexOf(heading);
if (headingIdx === -1) {
  console.error(`Voce "${heading}" non trovata in CHANGELOG.md`);
  process.exit(1);
}
const nextHeadingIdx = changelog.indexOf('\n## v', headingIdx + heading.length);
const entryEndIdx = nextHeadingIdx === -1 ? changelog.length : nextHeadingIdx;
const entrySoFar = changelog.slice(headingIdx, entryEndIdx);

if (entrySoFar.includes('\n- Build:')) {
  console.log('Riga "Build:" già presente per questa versione, salto la modifica al changelog.');
} else {
  const insertAt = entryEndIdx;
  changelog = changelog.slice(0, insertAt).replace(/\n*$/, '\n') + buildLine + '\n\n' + changelog.slice(insertAt).replace(/^\n+/, '');
  fs.writeFileSync(changelogPath, changelog);

  run('git config user.name "github-actions[bot]"');
  run('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  run('git add CHANGELOG.md');
  run(`git commit -m "chore(release): registra build v${version} [skip ci]"`);
  run('git push origin HEAD:main');
}

// Note della release GitHub = testo della voce di changelog appena scritta
const finalChangelog = fs.readFileSync(changelogPath, 'utf8');
const finalHeadingIdx = finalChangelog.indexOf(heading);
const finalNextHeadingIdx = finalChangelog.indexOf('\n## v', finalHeadingIdx + heading.length);
const finalEntryEndIdx = finalNextHeadingIdx === -1 ? finalChangelog.length : finalNextHeadingIdx;
const entryText = finalChangelog.slice(finalHeadingIdx, finalEntryEndIdx).trim();

const notesPath = path.join(repoRoot, '.release-notes.md');
fs.writeFileSync(notesPath, entryText + '\n');
try {
  run(`gh release edit "v${version}" --repo "${REPO}" --notes-file "${notesPath}"`);
} finally {
  fs.unlinkSync(notesPath);
}

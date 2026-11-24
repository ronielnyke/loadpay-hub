'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const commitCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
}).trim();

if (!/^[1-9]\d*$/.test(commitCount)) {
  throw new Error('Could not determine the Git commit count for the app version.');
}

const baseline = { major: 2, minor: 4, patch: 30, commitCount: 6 };
const commitsSinceBaseline = Number(commitCount) - baseline.commitCount;
if (!Number.isSafeInteger(commitsSinceBaseline) || commitsSinceBaseline < 0) {
  throw new Error('The Git history is older than the configured app version baseline.');
}

const version = `${baseline.major}.${baseline.minor}.${baseline.patch + commitsSinceBaseline}`;
const versionFile = path.join(root, 'js', 'version.js');
const contents = `window.APP_VERSION = '${version}';\nconst versionLabel = document.getElementById('app-version');\nif (versionLabel) versionLabel.textContent = window.APP_VERSION;\n`;
const manifestFile = path.join(root, 'site.webmanifest');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.version = version;
manifest.description = `Version ${version}. ${String(manifest.description || '').replace(/^Version \d+\.\d+\.\d+\.\s*/, '')}`;

fs.writeFileSync(versionFile, contents, 'utf8');
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Generated LoadPay Hub version ${version}`);

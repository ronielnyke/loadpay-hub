'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
}).trim();

if (!/^[1-9]\d*$/.test(count)) {
  throw new Error('Could not determine the Git commit count for the app version.');
}

const version = `1.0.${count}`;
const versionFile = path.join(root, 'js', 'version.js');
const contents = `window.APP_VERSION = '${version}';\nconst versionLabel = document.getElementById('app-version');\nif (versionLabel) versionLabel.textContent = window.APP_VERSION;\n`;

fs.writeFileSync(versionFile, contents, 'utf8');
console.log(`Generated LoadPay Hub version ${version}`);

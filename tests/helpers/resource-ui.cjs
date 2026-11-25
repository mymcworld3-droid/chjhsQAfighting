'use strict';
const fs = require('node:fs');
const vm = require('node:vm');

// Isolated browser fixtures strip ESM imports. Supply the actual presentation
// exports so reward assertions exercise the same markup as the browser.
const source = fs.readFileSync(require.resolve('../../public/cultivation/spirit-stone-ui.js'), 'utf8');
module.exports = {...require('./presentations.cjs'),...vm.runInNewContext(source.replace(/^export /gm, '') +
  '\n({stoneCostMarkup,cultivationMarkup,formatResourceAmount,weaponDungeonTicketMarkup})')};

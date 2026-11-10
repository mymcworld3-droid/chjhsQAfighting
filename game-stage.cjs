'use strict';
// Standalone quiz branch: all document entrypoints render the quiz directly.
const { sendPage } = require('./deployment-guard.cjs');
module.exports = function registerGameStage(app) {
  const homepage = sendPage('index.html');
  app.get(['/', '/index.html', '/app.html', '/stage.html'], homepage);
};

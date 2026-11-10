'use strict';
// The legacy game retains its stage/iframe navigation, but every HTML entry
// receives the same deployment indicator and never uses stale document caches.
const { sendPage } = require('./deployment-guard.cjs');
module.exports = function registerGameStage(app) {
  const stage = sendPage('stage.html');
  const game = sendPage('index.html');
  app.get(['/', '/index.html', '/stage.html'], stage);
  app.get('/app.html', game);
};

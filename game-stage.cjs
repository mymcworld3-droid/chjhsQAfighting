'use strict';
const path = require('node:path');
// The simple-quiz branch serves the new standalone quiz directly.
// Do not wrap it in the legacy cultivation iframe stage.
module.exports = function registerGameStage(app) {
  const publicDir = path.join(__dirname, 'public');
  const homepage = path.join(publicDir, 'index.html');
  for (const route of ['/', '/index.html', '/app.html', '/stage.html']) {
    app.get(route, (_req, res) => {
      res.set('Cache-Control', 'no-store, max-age=0');
      res.sendFile(homepage);
    });
  }
};

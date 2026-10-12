'use strict';
const path = require('node:path');
module.exports = function registerGameStage(app) {
  const publicDir = path.join(__dirname,'public');
  app.get(['/','/index.html'],(_,res) => res.sendFile(path.join(publicDir,'stage.html')));
  app.get('/app.html',(_,res) => res.sendFile(path.join(publicDir,'index.html')));
};

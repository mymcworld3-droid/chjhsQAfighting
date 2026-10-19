'use strict';
// Dispatch at call time: dotenv may load after modules are imported.
const names = ['serverTimestamp','increment','arrayUnion','arrayRemove','delete'];
const FieldValue = Object.fromEntries(names.map(name => [name, (...args) =>
  process.env.GAME_DATA_BACKEND === 'd1'
    ? {__d1op:name,args}
    : require('firebase-admin/firestore').FieldValue[name](...args)]));
module.exports = {FieldValue};

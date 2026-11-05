// Buildings, stairs and bridges stay in one painting and share one coordinate system.
// Only the contract altar and leaderboard ship are separate scene objects.
(function (root) {
  'use strict';
  const sprites = {
  "rank": {
    "image": "assets/training/cutouts/rank-ship.webp",
    "width": 1536,
    "height": 1024,
    "crop": [0, 0, 1536, 1024]
  },
  "contract": {
    "image": "assets/training/cutouts/contract-ai.webp",
    "width": 768,
    "height": 512,
    "crop": [0, 0, 768, 512]
  },
  "meditation": {
    "image": "assets/training/cutouts/meditation-ai.webp",
    "width": 1672,
    "height": 941,
    "crop": [
      285,
      9,
      1102,
      880
    ]
  },
  "vault": {
    "image": "assets/training/cutouts/vault-ai.webp",
    "width": 1536,
    "height": 1024,
    "crop": [
      91,
      10,
      1353,
      983
    ]
  },
  "forge": {
    "image": "assets/training/cutouts/forge-ai.webp",
    "width": 1672,
    "height": 941,
    "crop": [
      98,
      9,
      1488,
      925
    ]
  },
  "secret": {
    "image": "assets/training/cutouts/secret-ai.webp",
    "width": 1487,
    "height": 1058,
    "crop": [
      138,
      17,
      1307,
      1021
    ]
  },
  "status": {
    "image": "assets/training/cutouts/status-ai.webp",
    "width": 1536,
    "height": 1024,
    "crop": [
      162,
      5,
      1219,
      1010
    ]
  }
};
  const place = (id, bounds, label, lock) => ({ bounds, label, lock,
    painted: id !== 'contract' && id !== 'rank', sprite: sprites[id] });
  const layerArt = typeof module === 'object' && module.exports
    ? require('./training-scene-layer-art.js') : root.QATrainingSceneLayerArt;
  // Clouds may drift over the painting; solid terrain must never move or scale
  // independently of the buildings it supports.
  const sceneLayers = orientation => [
    { id: 'cloud-far', kind: 'cloud', band: 'upper', motion: 'far' },
    { id: 'cloud-near', kind: 'cloud', band: 'near', motion: 'near' }
  ].map(layer => ({ ...layer, ...layerArt[orientation][layer.id] }));
  const layouts = {
    landscape: {
      image: 'assets/training/cultivation-landscape.webp', layers: sceneLayers('landscape'), width: 1672, height: 941, font: 26,
      places: {
        meditation: place('meditation', [602,130,505,480], [845,594], [845,406]),
        vault: place('vault', [150,140,340,288], [310,389], [311,286]),
        forge: place('forge', [43,438,502,341], [305,739], [303,614]),
        contract: place('contract', [550,620,250,200], [675,794], [675,700]),
        secret: place('secret', [1208,137,310,293], [1360,390], [1367,271]),
        status: place('status', [1183,465,378,345], [1368,770], [1376,637]),
        rank: place('rank', [823,620,325,232], [985,822], [985,735])
      }
    },
    portrait: {
      image: 'assets/training/cultivation-portrait.webp', layers: sceneLayers('portrait'), width: 941, height: 1672, font: 36,
      places: {
        meditation: place('meditation', [237,574,482,378], [486,936], [481,766]),
        vault: place('vault', [17,228,354,311], [198,479], [198,374]),
        forge: place('forge', [18,945,340,361], [198,1246], [198,1131]),
        contract: place('contract', [365,1080,190,230], [460,1270], [460,1180]),
        secret: place('secret', [603,265,316,315], [763,521], [773,419]),
        status: place('status', [561,952,362,435], [762,1302], [771,1151]),
        rank: place('rank', [376,226,224,298], [488,484], [488,390])
      }
    }
  };
  const api = Object.freeze(layouts);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QATrainingSceneLayouts = api;
})(globalThis);

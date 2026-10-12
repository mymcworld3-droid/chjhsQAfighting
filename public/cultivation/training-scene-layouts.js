// Shared AI-extracted alpha sprites retain fine roof tips, railings and ornaments.
// Both fixed-ratio maps use the same five sprites on independently composed clean plates.
(function (root) {
  'use strict';
  const sprites = {
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
  const place = (id, bounds, label, lock) => ({ bounds, label, lock, sprite: sprites[id] });
  const layouts = {
    landscape: {
      image: 'assets/training/cultivation-landscape-clean.webp', width: 1672, height: 941, font: 28,
      places: {
        meditation: place('meditation', [602,130,505,480], [845,566], [845,406]),
        vault: place('vault', [150,140,340,288], [310,389], [311,286]),
        forge: place('forge', [43,438,502,341], [305,739], [303,614]),
        secret: place('secret', [1208,137,310,293], [1360,390], [1367,271]),
        status: place('status', [1183,465,378,345], [1368,770], [1376,637])
      }
    },
    portrait: {
      image: 'assets/training/cultivation-portrait-clean.webp', width: 941, height: 1672, font: 40,
      places: {
        meditation: place('meditation', [237,574,482,378], [486,900], [481,766]),
        vault: place('vault', [17,228,354,311], [198,479], [198,374]),
        forge: place('forge', [18,945,425,361], [238,1246], [244,1131]),
        secret: place('secret', [603,265,316,315], [763,521], [773,419]),
        status: place('status', [561,952,362,435], [762,1302], [771,1151])
      }
    }
  };
  const api = Object.freeze(layouts);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QATrainingSceneLayouts = api;
})(globalThis);

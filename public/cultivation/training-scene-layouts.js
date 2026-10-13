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
  // The order is the depth order: each mountain silhouette occludes the cloud
  // bank behind it. All plates share the original map's camera and coordinates.
  const layerArt = typeof module === 'object' && module.exports
    ? require('./training-scene-layer-art.js') : root.QATrainingSceneLayerArt;
  // Register each extracted platform to the existing building footprint. AI
  // extraction can enlarge a silhouette even when retaining the full canvas.
  const islandRegistration = {
    landscape: {
      'island-vault': [.74, [466, 340], [310, 322]],
      'island-secret': [.9, [1338, 405], [1367, 348]],
      'island-meditation': [.8, [860, 450], [848, 455]],
      'island-forge': [.65, [443, 580], [310, 655]],
      'island-status': [1.05, [1385, 709], [1375, 718]]
    },
    portrait: {
      'island-vault': [.76, [338, 570], [182, 439]],
      'island-secret': [.72, [714, 564], [775, 486]],
      'island-meditation': [1.08, [477, 800], [487, 860]],
      'island-forge': [.75, [276, 1126], [252, 1198]],
      'island-status': [.76, [670, 1159], [758, 1270]]
    }
  };
  const sceneLayers = orientation => [
    { id: 'cloud-far', kind: 'cloud', motion: 'far' },
    { id: 'mountains-middle', kind: 'mountain' },
    { id: 'cloud-upper', kind: 'cloud', asset: 'cloud-middle', band: 'upper', motion: 'upper' },
    { id: 'island-vault', kind: 'island' },
    { id: 'island-secret', kind: 'island' },
    { id: 'cloud-middle', kind: 'cloud', band: 'middle', motion: 'middle' },
    { id: 'island-meditation', kind: 'island' },
    { id: 'cloud-lower', kind: 'cloud', asset: 'cloud-middle', band: 'lower', motion: 'lower' },
    { id: 'island-forge', kind: 'island' },
    { id: 'island-status', kind: 'island' },
    { id: 'cloud-near', kind: 'cloud', band: 'near', motion: 'near' }
  ].map(layer => {
    const art = layerArt[orientation][layer.asset || layer.id];
    if (layer.id === 'cloud-near') {
      const [x, y, width, height] = art.bounds;
      return { ...layer, ...art, bounds: [x, y, width, height * 1.32] };
    }
    const registration = islandRegistration[orientation][layer.id];
    if (!registration) return { ...layer, ...art };
    const [scale, source, target] = registration, [x, y, width, height] = art.bounds;
    return { ...layer, ...art, bounds: [target[0] + (x - source[0]) * scale,
      target[1] + (y - source[1]) * scale, width * scale, height * scale] };
  });
  const layouts = {
    landscape: {
      image: 'assets/training/layers/landscape-far.webp', layers: sceneLayers('landscape'), width: 1672, height: 941, font: 28,
      places: {
        meditation: place('meditation', [602,130,505,480], [845,566], [845,406]),
        vault: place('vault', [150,140,340,288], [310,389], [311,286]),
        forge: place('forge', [43,438,502,341], [305,739], [303,614]),
        secret: place('secret', [1208,137,310,293], [1360,390], [1367,271]),
        status: place('status', [1183,465,378,345], [1368,770], [1376,637])
      }
    },
    portrait: {
      image: 'assets/training/layers/portrait-far.webp', layers: sceneLayers('portrait'), width: 941, height: 1672, font: 40,
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

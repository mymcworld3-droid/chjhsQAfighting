/* Generated full-body frames. Rectangles use the atlas's pixel coordinates. */
(function (root) {
  'use strict';
  const sheets = {
    bodyA: { cutoff: 125, scale: 0.54286, frames: [
      [14, 13, 104, 179, 59], [168, 14, 105, 177, 59], [323, 16, 128, 174, 57], [485, 15, 105, 176, 56],
      [12, 220, 106, 178, 62], [160, 222, 118, 176, 54], [312, 226, 144, 172, 58], [484, 226, 116, 172, 55],
      [12, 432, 121, 174, 63], [163, 431, 126, 176, 63], [312, 433, 140, 173, 68], [481, 433, 124, 174, 64],
    ] },
    bodyB: { cutoff: 125, scale: 0.59375, frames: [
      [43, 4, 95, 166, 58], [222, 7, 101, 163, 59], [400, 9, 109, 161, 64], [581, 8, 111, 161, 64],
      [41, 187, 98, 161, 58], [218, 190, 109, 157, 54], [397, 190, 122, 157, 57], [576, 190, 125, 157, 59],
      [37, 370, 125, 161, 52], [215, 372, 113, 159, 54], [394, 376, 113, 155, 56], [573, 376, 115, 155, 58],
    ] },
    chain: { cutoff: 125, scale: 0.58642, frames: [
      [36, 6, 107, 160, 54], [211, 12, 126, 155, 54], [391, 5, 112, 162, 61], [570, 5, 121, 162, 65],
      [33, 185, 110, 162, 63], [209, 187, 128, 162, 62], [394, 187, 112, 161, 61], [574, 192, 123, 156, 54],
      [35, 370, 119, 161, 60], [214, 368, 104, 163, 63], [397, 366, 101, 166, 53], [575, 365, 103, 167, 61],
    ] },
    swordA: { cutoff: 183, scale: 0.58282, frames: [
      [36, 4, 103, 166, 62], [214, 4, 108, 166, 58], [390, 10, 139, 159, 58], [571, 15, 144, 154, 55],
      [32, 187, 107, 162, 60], [186, 189, 142, 159, 67], [391, 189, 144, 161, 65], [574, 197, 130, 152, 65],
      [38, 369, 102, 164, 60], [218, 369, 103, 165, 60], [394, 369, 121, 164, 62], [578, 369, 103, 165, 61],
    ] },
    swordB: { cutoff: 125, scale: 0.57576, frames: [
      [42, 3, 99, 168, 58], [223, 3, 99, 168, 59], [404, 3, 98, 168, 58], [585, 4, 109, 167, 54],
      [41, 185, 101, 166, 57], [221, 186, 101, 165, 59], [399, 188, 115, 163, 55], [582, 187, 100, 164, 59],
      [36, 368, 130, 165, 67], [220, 368, 114, 165, 63], [400, 370, 112, 163, 62], [581, 370, 102, 163, 60],
    ] },
  };
  const moves = {
    'wind-slash': ['swordA', 0],
    'wind-step': ['swordA', 1],
    'wind-thousand': ['swordA', 2],
    'flight-summon': ['swordB', 0],
    'sky-cloud': ['swordB', 1],
    'sky-sever': ['swordB', 2],
    'rock-fist': ['bodyA', 0],
    'rock-quake': ['bodyA', 1],
    'rock-break': ['bodyA', 2],
    'dragon-roar': ['bodyB', 0],
    'tiger-step': ['bodyB', 1],
    'tiger-throw': ['bodyB', 2]
  };

  const sources = Object.fromEntries(Object.keys(sheets).map(key => [
    key, '/assets/world-map/players/techniques/' + key + '.webp'
  ]));
  const preparedSheets = new WeakMap();

  function prepare(key, image) {
    if (!image?.complete || !image.naturalWidth) return null;
    if (preparedSheets.has(image)) return preparedSheets.get(image);
    const cutoff = sheets[key].cutoff;
    if (!cutoff) return image;

    // The art is delivered with alpha. Discard its faint backdrop when
    // compositing on the battlefield. Keep edge coverage for a soft outline.
    const surface = document.createElement('canvas');
    surface.width = image.naturalWidth;
    surface.height = image.naturalHeight;
    const ctx = surface.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, surface.width, surface.height);
    for (let i = 3; i < pixels.data.length; i += 4) {
      pixels.data[i] = (pixels.data[i] - cutoff) * 255 / 23;
    }
    ctx.putImageData(pixels, 0, 0);
    preparedSheets.set(image, surface);
    return surface;
  }

  function pick(scene, progress, move) {
    if (move === 'dragon-guard') {
      const hit = scene.impactStart ?? .15;
      const step = Math.min(3, Math.max(0, (scene.step ?? 1) - 1));
      const slot = progress < hit ? step * 2 : progress < .56 ? step * 2 + 1 : 8 + step;
      return ['chain', slot];
    }
    const entry = moves[move];
    if (!entry) return null;
    const [sheet, row] = entry;
    let frame;
    if (scene.kind === 'move') {
      frame = progress < .23 ? 0 : 1;
    } else if (move === 'tiger-throw') {
      frame = progress < .20 ? 0 : progress < .32 ? 1 : progress < .78 ? 2 : 3;
    } else {
      const hit = scene.impactStart ?? .46;
      frame = progress < hit * .48 ? 0 : progress < hit ? 1 : progress < .78 ? 2 : 3;
    }
    return [sheet, row * 4 + frame];
  }

  function draw(ctx, actor, scene, progress, box, images) {
    if (actor.bot || actor.gender === 'female' || scene?.actor !== actor.uid ||
        !['cast', 'move'].includes(scene?.kind)) return false;
    const move = root.QAManuals?.BY_SKILL?.[scene.skill || scene.visualSkill]?.moveId ||
      scene.skill || scene.visualSkill;
    const facing = root.QATacticalActorRig.facing(scene, actor);
    const selfCast = move === 'dragon-roar';
    if (!selfCast && facing !== 1 && facing !== 2) return false;

    const frame = pick(scene, progress, move);
    if (!frame) return false;
    const [sheet, index] = frame;
    const art = prepare(sheet, images[sheet]);
    if (!art) return false;
    const [sx, sy, width, height, footX] = sheets[sheet].frames[index];
    const scale = sheets[sheet].scale;
    ctx.save();
    ctx.translate(box.x + box.width / 2, box.y + box.height * 102 / 112);
    ctx.scale((facing === 2 ? -1 : 1) * box.width / 112, box.height / 112);
    ctx.drawImage(art, sx, sy, width, height, -footX * scale, -height * scale, width * scale, height * scale);
    ctx.restore();
    return true;
  }

  root.QAGeneratedTechniqueFrames = Object.freeze({ sources, draw, pick });
})(globalThis);

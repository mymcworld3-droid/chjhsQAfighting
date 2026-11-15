'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

const directory = join(__dirname, 'vocabulary-audio');

module.exports = function registerVocabularyAudio(app) {
  let index;
  const packs = new Map();
  app.get('/assets/audio/vocabulary/:word.mp3', (req, res, next) => {
    const { word } = req.params;
    if (!/^[a-z]+$/.test(word)) return res.sendStatus(404);
    try {
      index ||= JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'));
      if (!Object.hasOwn(index, word)) return res.sendStatus(404);
      const [pack, offset, length] = index[word];
      if (!packs.has(pack)) packs.set(pack, readFileSync(join(directory, `words-${pack}.bin`)));
      const clip = packs.get(pack).subarray(offset, offset + length);
      if (clip.length !== length) throw new Error('Incomplete vocabulary audio clip');

      const etag = '"' + createHash('sha1').update(clip).digest('hex') + '"';
      res.type('audio/mpeg').set({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
        ETag: etag,
      });
      if (req.fresh) return res.status(304).end();
      const ifRange = req.get('If-Range');
      const ranges = ifRange && ifRange !== etag ? undefined : req.range(length, { combine: true });
      if (ranges === -1) {
        return res.status(416).set('Content-Range', 'bytes */' + length).end();
      }
      if (ranges?.type === 'bytes' && ranges.length === 1) {
        const { start, end } = ranges[0];
        return res.status(206).set('Content-Range', `bytes ${start}-${end}/${length}`).send(clip.subarray(start, end + 1));
      }
      return res.send(clip);
    } catch (error) {
      return next(error);
    }
  });
};

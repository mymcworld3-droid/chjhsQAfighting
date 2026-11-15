#!/usr/bin/env python3
"""Build the American English word clips. Requires libflite with the SLT voice and FFmpeg."""

import ctypes
from ctypes.util import find_library
import json
import math
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'vocabulary-audio'
WORDS_PER_PACK = 20

# The examples teach the verb senses. A preceding modal selects their verb
# pronunciation in the Flite lexicon. The generator then isolates the last word.
VERB_CONTEXT = {
    'articulate': 'She can articulate.',
    'attribute': 'We must attribute.',
    'conduct': 'We can conduct.',
    'implement': 'They can implement.',
}


def bind(lib, name, result, *arguments):
    function = getattr(lib, name)
    function.restype = result
    function.argtypes = arguments
    return function


class Voice:
    def __init__(self):
        lib = ctypes.CDLL(find_library('flite'))
        us_voice = ctypes.CDLL(find_library('flite_cmu_us_slt'))
        pointer, text = ctypes.c_void_p, ctypes.c_char_p
        bind(lib, 'flite_init', ctypes.c_int)()
        self.voice = bind(us_voice, 'register_cmu_us_slt', pointer, text)(None)
        self.synth = bind(lib, 'flite_synth_text', pointer, text, pointer)
        self.relation = bind(lib, 'utt_relation', pointer, pointer, text)
        self.tail = bind(lib, 'relation_tail', pointer, pointer)
        self.as_relation = bind(lib, 'item_as', pointer, pointer, text)
        self.daughter = bind(lib, 'item_daughter', pointer, pointer)
        self.previous = bind(lib, 'item_prev', pointer, pointer)
        self.feature = bind(lib, 'item_feat_float', ctypes.c_float, pointer, text)
        self.wave = bind(lib, 'utt_wave', pointer, pointer)
        self.save_wave = bind(lib, 'cst_wave_save_riff', ctypes.c_int, pointer, text)
        self.delete = bind(lib, 'delete_utterance', None, pointer)

    def write_word(self, word, destination):
        context = VERB_CONTEXT.get(word)
        utterance = self.synth((context or word + '.').encode(), self.voice)
        if not utterance:
            raise RuntimeError(f'Flite could not synthesize {word}')
        try:
            start = 0
            if context:
                last_word = self.tail(self.relation(utterance, b'Word'))
                structure = self.as_relation(last_word, b'SylStructure')
                first_phone = self.as_relation(self.daughter(self.daughter(structure)), b'Segment')
                preceding_phone = self.previous(first_phone)
                start = self.feature(preceding_phone, b'end')
            self.save_wave(self.wave(utterance), str(destination).encode())
            return start
        finally:
            self.delete(utterance)


def main():
    vocabulary = subprocess.check_output([
        'node', '--input-type=module', '-e',
        "import { WORDS } from './public/cultivation/daily-vocabulary-words.mjs'; "
        "console.log(JSON.stringify(WORDS.map(word => word.id).sort()));",
    ], cwd=ROOT)
    words = json.loads(vocabulary)
    voice = Voice()
    OUTPUT.mkdir(exist_ok=True)
    index = {}
    with tempfile.TemporaryDirectory() as temporary:
        source = Path(temporary) / 'word.wav'
        encoded = Path(temporary) / 'word.mp3'
        for pack in range(math.ceil(len(words) / WORDS_PER_PACK)):
            start = pack * WORDS_PER_PACK
            with (OUTPUT / f'words-{pack}.bin').open('wb') as bundle:
                for word in words[start:start + WORDS_PER_PACK]:
                    trim = voice.write_word(word, source)
                    filters = (
                        f'atrim=start={trim:.6f},asetpts=PTS-STARTPTS,adelay=45:all=1,'
                        'atempo=0.92,highpass=f=90,volume=2dB,alimiter=limit=0.84:latency=1'
                    )
                    subprocess.run([
                        'ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', str(source),
                        '-af', filters, '-c:a', 'libmp3lame', '-ac', '1', '-ar', '24000', '-b:a', '32k',
                        '-map_metadata', '-1', str(encoded),
                    ], check=True)
                    clip = encoded.read_bytes()
                    index[word] = [pack, bundle.tell(), len(clip)]
                    bundle.write(clip)
    with (OUTPUT / 'index.json').open('w') as file:
        json.dump(index, file, indent=None, separators=(',', ':'))
        file.write('\n')
    print(f'{len(index)} clips, {sum(clip[2] for clip in index.values())} bytes')


if __name__ == '__main__':
    main()

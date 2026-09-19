"""Opt-in real YouTube audio check. Prints no cookies, URLs, or credentials."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from host import AudioHelper, HIDDEN

if len(sys.argv) != 2:
    raise SystemExit('Usage: speech-runtime Python scripts/probe-audio.py YOUTUBE_VIDEO_ID')
helper = AudioHelper()
started = time.monotonic()
try:
    info = helper.prepare(sys.argv[1], 'auto')
    elapsed = time.monotonic() - started
    duration = min(info['duration'], 32)
    audio = base64.b64decode(helper.chunk(0, duration)['audio'])
    result = subprocess.run([helper.ffmpeg(), '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le',
                             '-ac', '1', '-ar', '16000', 'pipe:1'], input=audio, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, creationflags=HIDDEN, timeout=30, check=True)
    print(json.dumps({'videoId': sys.argv[1], 'duration': info['duration'], 'language': info['language'],
                      'audioBytes': helper.media.stat().st_size, 'downloadSeconds': round(elapsed, 2),
                      'chunkBytes': len(audio), 'decodedSeconds': round(len(result.stdout) / 32000, 3),
                      'speechApiCalled': False}, indent=2))
finally:
    helper.cancel()
    helper.cleanup()

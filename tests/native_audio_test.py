import base64
import io
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from host import AudioHelper, read_message, write_message, HIDDEN

class NativeAudioTests(unittest.TestCase):
    def test_protocol_rejects_oversized_and_truncated_messages(self):
        stream = io.BytesIO()
        write_message(stream, {'id': 'test', 'ok': True})
        stream.seek(0)
        self.assertTrue(read_message(stream)['ok'])
        for data in [b'ab', struct.pack('<I', 20000), struct.pack('<I', 100) + b'{}']:
            with self.assertRaises(ValueError):
                read_message(io.BytesIO(data))

    def test_invalid_arguments_never_execute_commands(self):
        helper = AudioHelper()
        try:
            for video in ['https://example.com', '../arbitrary', 'x;whoami']:
                with self.assertRaises(ValueError):
                    helper.prepare(video, 'auto')
            with self.assertRaises(ValueError):
                helper.prepare('abcdefghijk', 'en];evil')
            with self.assertRaises(ValueError):
                helper.chunk(0, 30)
        finally:
            helper.cleanup()

    def test_ffmpeg_generates_independently_decodable_bounded_webm(self):
        helper = AudioHelper()
        try:
            media = helper.directory / 'fixture.wav'
            helper.run([helper.ffmpeg(), '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                        'sine=frequency=440:duration=4', '-y', str(media)], timeout=15)
            helper.media = media
            helper.duration = 4
            audio = base64.b64decode(helper.chunk(1, 3)['audio'])
            self.assertEqual(audio[:4], bytes.fromhex('1a45dfa3'))
            result = subprocess.run([helper.ffmpeg(), '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
                                     '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], input=audio,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=HIDDEN, timeout=15)
            self.assertEqual(result.returncode, 0)
            self.assertAlmostEqual(len(result.stdout) / 32000, 2, delta=0.05)
            with self.assertRaises(ValueError):
                helper.chunk(0, 99)
        finally:
            helper.cleanup()

    def test_native_process_handshake(self):
        process = subprocess.Popen([sys.executable, '-u', str(Path(__file__).resolve().parents[1] / 'native' / 'host.py')],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=HIDDEN)
        try:
            write_message(process.stdin, {'id': 'handshake', 'type': 'ping'})
            result = read_message(process.stdout)
            self.assertEqual(result['id'], 'handshake')
            self.assertTrue(result['ffmpeg'])
            self.assertTrue(result['node'])
            write_message(process.stdin, {'id': 'shutdown', 'type': 'shutdown'})
            self.assertTrue(read_message(process.stdout)['closed'])
        finally:
            process.stdin.close()
            process.wait(timeout=15)
            process.stdout.close()
            process.stderr.close()

    def test_cancellation_terminates_running_child(self):
        helper = AudioHelper()
        errors = []
        def run():
            try:
                helper.run([sys.executable, '-c', 'import time; time.sleep(60)'])
            except RuntimeError as error:
                errors.append(error)
        worker = threading.Thread(target=run)
        worker.start()
        try:
            deadline = time.monotonic() + 5
            while helper.process is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertIsNotNone(helper.process)
            helper.cancel()
            worker.join(timeout=5)
            self.assertFalse(worker.is_alive())
            self.assertTrue(errors)
        finally:
            helper.cancel()
            worker.join(timeout=5)
            helper.cleanup()

if __name__ == '__main__':
    unittest.main()

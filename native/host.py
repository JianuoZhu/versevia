"""Sentence native audio helper. No HTTP listener, browser cookies, or ASR keys.

Chrome communicates using length-prefixed JSON. Only a YouTube ID, language,
and bounded clip intervals are accepted; no caller-controlled paths/commands.
"""
import base64
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading

MAX_MESSAGE = 900_000
VIDEO = re.compile(r"^[A-Za-z0-9_-]{11}$")
LANGUAGE = re.compile(r"^(auto|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$")
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def read_message(stream):
    head = stream.read(4)
    if not head:
        return None
    if len(head) != 4:
        raise ValueError("Truncated message.")
    size = struct.unpack("<I", head)[0]
    if size > 16384:
        raise ValueError("Request is too large.")
    payload = stream.read(size)
    if len(payload) != size:
        raise ValueError("Truncated message.")
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise ValueError("Invalid message.")
    return value


def write_message(stream, value):
    data = json.dumps(value, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_MESSAGE:
        raise ValueError("Audio chunk exceeds the native message limit.")
    stream.write(struct.pack("<I", len(data)) + data)
    stream.flush()


class AudioHelper:
    def __init__(self):
        self.directory = Path(tempfile.mkdtemp(prefix="sentence-audio-")).resolve()
        self.media = None
        self.duration = 0
        self.cancelled = threading.Event()
        self.lock = threading.Lock()
        self.process = None

    def ffmpeg(self):
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()

    def run(self, args, timeout=540):
        with self.lock:
            if self.cancelled.is_set():
                raise RuntimeError("Audio preparation cancelled.")
            process = self.process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                                       stderr=subprocess.PIPE, creationflags=HIDDEN)
        try:
            out, err = process.communicate(timeout=timeout)
            if process.returncode:
                # Never echo yt-dlp diagnostics: they can contain signed URLs.
                detail = err.decode("utf-8", errors="replace").lower()
                if "sign in" in detail or "login" in detail or "cookies" in detail:
                    raise RuntimeError("YouTube requires authentication for this request. This helper does not read browser cookies.")
                if "requested format" in detail:
                    raise RuntimeError("No downloadable audio track matches the selected language. Try Match video.")
                if "403" in detail or "forbidden" in detail:
                    raise RuntimeError("YouTube refused this audio download (HTTP 403). Update the helper dependencies and retry.")
                raise RuntimeError("Audio download or conversion failed. Check connectivity and update the helper dependencies.")
            return out
        except subprocess.TimeoutExpired:
            self.kill(process)
            process.communicate()
            raise RuntimeError("Audio preparation timed out.") from None
        finally:
            with self.lock:
                if self.process is process:
                    self.process = None

    @staticmethod
    def kill(process):
        if process.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=HIDDEN, timeout=10)
        else:
            process.kill()

    def prepare(self, video_id, language):
        if not isinstance(video_id, str) or not VIDEO.fullmatch(video_id):
            raise ValueError("Invalid YouTube video ID.")
        if not isinstance(language, str) or not LANGUAGE.fullmatch(language):
            raise ValueError("Invalid audio language.")
        if self.media:
            raise ValueError("A video is already prepared.")
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Install Node.js 22 or newer for YouTube audio extraction.")
        # Match video prefers the original audio when yt-dlp labels it.
        selection = "ba[format_note*=original]/ba" if language == "auto" else f"ba[language^={language.split('-')[0]}]"
        args = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist", "--no-cache-dir",
                "--no-progress", "--no-simulate", "--dump-single-json", "--socket-timeout", "20",
                "--retries", "2", "--fragment-retries", "2", "--max-filesize", "128M",
                "--match-filters", "!is_live & duration<=14400", "--js-runtimes", f"node:{node}",
                "--ffmpeg-location", self.ffmpeg(), "-f", selection, "-o", str(self.directory / "audio.%(ext)s"),
                "--", f"https://www.youtube.com/watch?v={video_id}"]
        info = json.loads(self.run(args))
        duration = info.get("duration")
        if info.get("id") != video_id or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= 14400:
            raise ValueError("Only recorded videos up to four hours are supported.")
        downloads = info.get("requested_downloads", [])
        path = Path(downloads[0].get("filepath", "")) if downloads else Path("")
        path = path.resolve()
        if path.parent != self.directory or not path.is_file() or not 0 < path.stat().st_size <= 128 * 1024 * 1024:
            raise ValueError("No complete audio file was downloaded (128 MB limit).")
        self.media = path
        self.duration = duration
        return {"duration": duration, "language": downloads[0].get("language") or info.get("language") or "auto"}

    def chunk(self, start, end):
        if not self.media:
            raise ValueError("Prepare a video first.")
        if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (start, end)) or not 0 <= start < end <= self.duration + 1 or end - start > 32.1:
            raise ValueError("Invalid audio interval.")
        audio = self.run([self.ffmpeg(), "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", str(start),
                          "-i", str(self.media), "-t", str(end - start), "-map", "0:a:0", "-vn", "-ac", "1",
                          "-ar", "16000", "-c:a", "libopus", "-b:a", "48k", "-f", "webm", "pipe:1"], timeout=25)
        if not 0 < len(audio) < 650000:
            raise ValueError("Invalid audio chunk size.")
        return {"audio": base64.b64encode(audio).decode("ascii")}

    def cancel(self):
        self.cancelled.set()
        with self.lock:
            if self.process:
                self.kill(self.process)

    def cleanup(self):
        # Only remove the exact temporary directory owned by this helper.
        if self.directory.parent == Path(tempfile.gettempdir()).resolve() and self.directory.name.startswith("sentence-audio-"):
            shutil.rmtree(self.directory, ignore_errors=True)


def main():
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    helper = AudioHelper()
    send_lock = threading.Lock()
    worker = None
    busy = threading.Event()

    def respond(message):
        with send_lock:
            write_message(sys.stdout.buffer, message)

    def handle(m):
        try:
            if m.get("type") == "ping":
                import yt_dlp.version
                result = {"version": yt_dlp.version.__version__, "ffmpeg": Path(helper.ffmpeg()).is_file(), "node": bool(shutil.which("node"))}
            elif m.get("type") == "prepare":
                result = helper.prepare(m.get("videoId"), m.get("language", "auto"))
            elif m.get("type") == "chunk":
                result = helper.chunk(m.get("start"), m.get("end"))
            else:
                raise ValueError("Unknown audio command.")
            busy.clear()
            respond({"id": m.get("id"), **result})
        except Exception as error:
            # Errors raised above are fixed messages; unexpected errors stay private.
            detail = str(error) if isinstance(error, (ValueError, RuntimeError)) and not isinstance(error, json.JSONDecodeError) else "Local audio helper failed."
            busy.clear()
            try:
                respond({"id": m.get("id"), "error": detail[:400]})
            except (OSError, ValueError):
                pass

    try:
        while (message := read_message(sys.stdin.buffer)) is not None:
            if message.get('type') == 'shutdown':
                helper.cancel()
                if worker:
                    worker.join(timeout=15)
                helper.cleanup()
                respond({'id': message.get('id'), 'closed': True})
                break
            if busy.is_set():
                respond({"id": message.get("id"), "error": "Audio helper is busy."})
                continue
            worker = threading.Thread(target=handle, args=(message,))
            busy.set()
            worker.start()
    finally:
        helper.cancel()
        if worker:
            worker.join(timeout=15)
        helper.cleanup()


if __name__ == "__main__":
    main()

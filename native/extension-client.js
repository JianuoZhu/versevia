export const HOST_NAME = 'com.sentence.audio';
// Native ports keep the worker alive during downloads; one private port per job.
export function nativeAudioClient(runtime = chrome.runtime) {
  const port = runtime.connectNative(HOST_NAME), pending = new Map(); let closed = false, closing;
  const fail = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  port.onMessage.addListener(m => {
    const p = pending.get(m?.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id);
    if (m.error) p.reject(new Error(String(m.error).slice(0, 400))); else p.resolve(m);
  });
  port.onDisconnect.addListener(() => {
    const detail = runtime.lastError?.message; closed = true;
    fail(new Error(detail ? 'Local audio helper unavailable. Run native/install.ps1 with this extension ID, then retry.' : 'Local audio helper disconnected.'));
  });
  const client = {
    request(type, data = {}, timeout = 600000) {
      if (closed) return Promise.reject(new Error('Local audio helper disconnected.'));
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Local audio helper timed out.')); }, timeout);
        pending.set(id, { resolve, reject, timer });
        try { port.postMessage({ id, type, ...data }); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    close() {
      if (closed) return Promise.resolve();
      if (closing) return closing;
      fail(new Error('Audio preparation cancelled.'));
      // Give the helper a chance to terminate children and remove temporary audio.
      closing = client.request('shutdown', {}, 5000).catch(() => {}).finally(() => { closed = true; port.disconnect(); });
      return closing;
    }
  };
  return client;
}

import { decodeSabrChunk } from '../extension/sabr-audio.js';
document.getElementById('run').onclick = async () => {
  const out = document.getElementById('result');
  try {
    const bytes = new Uint8Array(await (await fetch('./sabr-offset.webm')).arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    const blob = await decodeSabrChunk({ audio: btoa(binary), mimeType: 'audio/webm', start: 120, end: 140 }, 125, 130, new AbortController().signal);
    const view = new DataView(await blob.arrayBuffer()); let energy = 0;
    for (let i = 44; i < view.byteLength; i += 2) energy += (view.getInt16(i, true) / 32768) ** 2;
    const samples = (view.byteLength - 44) / 2;
    out.textContent = JSON.stringify({ status: 'PASS', duration: samples / 16000, sampleRate: view.getUint32(24, true), rms: Math.sqrt(energy / samples), bytes: blob.size }, null, 2);
  } catch (e) { out.textContent = `FAIL: ${e.message}`; }
};

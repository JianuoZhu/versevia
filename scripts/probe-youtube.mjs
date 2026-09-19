import { readFile, writeFile, mkdir } from 'node:fs/promises';
// Network smoke check; prints metadata only, never signed URLs or cookies.
const file = process.argv[2] || 'youtube-probe.html';
const html = await readFile(file, 'utf8');
const match = html.match(/(?:var\s+)?ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
if (!match) throw new Error('No initial player response found.');
const data = JSON.parse(match[1]);
const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
console.log(JSON.stringify({ videoId: data.videoDetails?.videoId, status: data.playabilityStatus?.status,
  tracks: tracks.map(t => ({ language: t.languageCode, automatic: t.kind === 'asr' })),
  hasStreamingData: !!data.streamingData }, null, 2));
if (process.argv.includes('--fetch') && tracks.length) {
  const url = new URL(tracks[0].baseUrl); url.searchParams.set('fmt', 'json3');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await response.text();
  console.log(JSON.stringify({ captionHTTP: response.status, bytes: body.length, looksLikeJSON: body.trim().startsWith('{') }));
  if (body.trim().startsWith('{')) {
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/live-captions.json', body);
  }
}

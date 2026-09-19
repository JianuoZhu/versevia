// MAIN-world bridge: only public player metadata and YouTube caption requests.
// Never send extension configuration or credentials across this boundary.
(() => {
  const CHANNEL = 'sentence-youtube-v1';
  const validVideo = id => typeof id === 'string' && /^[\w-]{11}$/.test(id);
  const observed = new Map();
  function remember(rawUrl, body) {
    try {
      const url = new URL(rawUrl, location.origin);
      if (url.origin !== location.origin || url.pathname !== '/api/timedtext' || url.searchParams.has('tlang') || !body?.trim() || body.length > 5000000) return;
      const videoId = url.searchParams.get('v');
      if (!validVideo(videoId)) return;
      const key = JSON.stringify([videoId, url.searchParams.get('lang'), url.searchParams.get('kind') || '', url.searchParams.get('name') || '']);
      observed.set(key, body);
      while (observed.size > 8) observed.delete(observed.keys().next().value);
      window.postMessage({ channel: CHANNEL, direction: 'observed', videoId }, location.origin);
    } catch { /* Ignore unrelated player requests. */ }
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]);
    if (url.includes('/api/timedtext')) promise.then(response => response.clone().text().then(body => remember(url, body))).catch(() => {});
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (String(url).includes('/api/timedtext')) this.addEventListener('load', () => {
      try {
        if (this.responseType === 'json') remember(String(url), JSON.stringify(this.response));
        else if (!this.responseType || this.responseType === 'text') remember(String(url), this.responseText);
      } catch { /* Nontext XHR. */ }
    }, { once: true });
    return originalOpen.call(this, method, url, ...rest);
  };
  function playerData(videoId) {
    const player = document.getElementById('movie_player');
    let current;
    // During player initialization, this getter can throw or return metadata
    // without captions even though the initial response has a usable tracklist.
    try { current = player?.getPlayerResponse?.(); } catch { /* Try the initial response below. */ }
    const candidates = [current, window.ytInitialPlayerResponse].filter(data => data?.videoDetails?.videoId === videoId);
    return candidates.find(data => data.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) || candidates[0];
  }
  function tracksFor(videoId) {
    const data = playerData(videoId);
    const list = data?.captions?.playerCaptionsTracklistRenderer;
    const defaultIndex = list?.audioTracks?.[list.defaultAudioTrackIndex || 0]?.defaultCaptionTrackIndex;
    return (list?.captionTracks ?? []).map((t, i) => ({
      id: t.vssId || String(i), language: t.languageCode, kind: t.kind === 'asr' ? 'automatic' : 'creator',
      label: t.name?.simpleText || t.name?.runs?.map(r => r.text).join('') || t.languageCode,
      url: t.baseUrl, isDefault: i === defaultIndex
    }));
  }
  let busy = false;
  window.addEventListener('message', async event => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== CHANNEL || m.direction !== 'request' || !validVideo(m.videoId)) return;
    if (!['discover', 'captions', 'select-track', 'audio-discover'].includes(m.type) || typeof m.requestId !== 'string') return;
    if (new URL(location.href).searchParams.get('v') !== m.videoId) return;
    const reply = data => window.postMessage({ channel: CHANNEL, direction: 'response', requestId: m.requestId, videoId: m.videoId, ...data }, location.origin);
    try {
      if (m.type === 'audio-discover') {
        let live; try { live = document.getElementById('movie_player')?.getPlayerResponse?.(); } catch { /* Initial response fallback. */ }
        const data = [live, window.ytInitialPlayerResponse].filter(d => d?.videoDetails?.videoId === m.videoId);
        const formats = data.flatMap(d => (d.streamingData?.adaptiveFormats || []).map(f => ({ ...f, duration: Number(d.videoDetails.lengthSeconds) })));
        const language = typeof m.language === 'string' && m.language !== 'auto' ? m.language.split('-')[0] : '';
        const audioLanguages = new Set(formats.filter(f => f.mimeType?.startsWith('audio/')).map(f => f.audioTrack?.id?.split('.')[0]).filter(Boolean));
        const sources = formats.filter(f => f.url && /^audio\/(webm|mp4);/.test(f.mimeType || '') && !f.drmFamilies?.length && !f.drmTrackType)
          // With multiple dubbed tracks, only SABR's active-track metadata can
          // establish what the viewer is hearing. Never guess the original track.
          .filter(f => audioLanguages.size <= 1)
          .filter(f => !language || f.audioTrack?.id?.split('.')[0]?.split('-')[0] === language)
          .filter(f => { try { const u = new URL(f.url); return u.protocol === 'https:' && u.hostname.endsWith('.googlevideo.com') && u.pathname === '/videoplayback' && !u.username && !u.password && !u.port; } catch { return false; } })
          .sort((a, b) => Number(/original/i.test(b.audioTrack?.displayName || '')) - Number(/original/i.test(a.audioTrack?.displayName || '')) || Number(b.audioTrack?.audioIsDefault || false) - Number(a.audioTrack?.audioIsDefault || false) || (a.bitrate || 0) - (b.bitrate || 0));
        // A signed media URL is public page data; it is never logged or persisted.
        const unique = [...new Map(sources.map(f => [f.url, f])).values()].slice(0, 2).map(f => ({ url: f.url, mimeType: f.mimeType, bytes: Number(f.contentLength), duration: f.duration, language: f.audioTrack?.id?.split('.')[0] || 'auto', trackId: f.audioTrack?.id || JSON.stringify([f.itag, f.lastModified, f.xtags || '']) }));
        reply({ sources: unique, reason: unique.length ? '' : data.some(d => d.streamingData?.serverAbrStreamingUrl) ? 'This player exposes SABR streaming without standalone audio URLs.' : 'No downloadable audio track was exposed by this player.' }); return;
      }
      const tracks = tracksFor(m.videoId);
      if (m.type === 'discover') { reply({ tracks: tracks.map(({ url, ...t }) => t), ready: !!playerData(m.videoId) }); return; }
      if (busy) throw new Error('Caption request already in progress. Retry shortly.');
      const track = tracks.find(t => t.id === m.trackId);
      if (!track?.url) throw new Error('This caption track is no longer available. Refresh tracks.');
      if (m.type === 'select-track') {
        const player = document.getElementById('movie_player');
        if (typeof player?.setOption !== 'function') throw new Error('Select the matching track using YouTube CC settings.');
        player.setOption('captions', 'track', { languageCode: track.language, kind: track.kind === 'automatic' ? 'asr' : '', vssId: track.id });
        reply({ selected: true }); return;
      }
      const url = new URL(track.url);
      if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/api/timedtext') throw new Error('Unsupported YouTube caption URL.');
      const key = JSON.stringify([m.videoId, url.searchParams.get('lang'), url.searchParams.get('kind') || '', url.searchParams.get('name') || '']);
      if (observed.has(key)) { reply({ body: observed.get(key) }); return; }
      url.searchParams.set('fmt', 'json3');
      busy = true;
      try {
        const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(12000), redirect: 'error' });
        if (!response.ok) throw new Error(`YouTube captions returned HTTP ${response.status}.`);
        const body = await response.text();
        if (!body.trim()) throw new Error('YouTube returned an empty caption response. This session may require player authorization; try enabling native CC and refreshing tracks.');
        if (body.length > 5000000) throw new Error('Caption track exceeds the 5 MB safety limit.');
        reply({ body });
      } finally { busy = false; }
    } catch (error) { reply({ error: error.name === 'TimeoutError' ? 'YouTube caption request timed out.' : error.message }); }
  });
})();

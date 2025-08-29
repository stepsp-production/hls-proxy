(function () {
  const video = document.getElementById('v');
  const input = document.getElementById('src');
  const btn   = document.getElementById('loadBtn');

  // src من query ?src=...
  const params = new URLSearchParams(location.search);
  input.value = params.get('src') || '/hls/live/playlist.m3u8';

  function load(url) {
    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        liveSyncDuration: 6
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
      window._hls = hls; // لأغراض تصحيحية
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(()=>{});
    } else {
      alert('HLS غير مدعوم في هذا المتصفح');
    }
  }

  btn.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) return;
    const u = val.startsWith('/') ? val : '/' + val.replace(/^\/+/, '');
    load(u);
    const p = new URLSearchParams(location.search);
    p.set('src', u);
    history.replaceState({}, '', '/player?' + p.toString());
  });

  load(input.value);
})();

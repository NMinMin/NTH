function createVideoPlayback(player, status, streamButton) {
 const maxBufferedSize = 128 * 1024 * 1024;
 const highBitrate = 12_000_000;
 let request;
 let objectUrl;

 function stop() {
  request?.abort();
  request = undefined;
  streamButton.hidden = true;
  player.pause();
  player.removeAttribute('src');
  player.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
 }

 function playSource(url, autoplay) {
  player.src = url;
  if (autoplay) player.play().catch(() => {});
 }

 async function start(video, url, autoplay) {
  stop();
  const size = Number(video.size);
  const bitrate = size * 8 / Number(video.duration);
  if (!(size > 0 && size <= maxBufferedSize && Number(video.duration) > 0 && bitrate >= highBitrate)) {
   playSource(url, autoplay);
   return;
  }

  const controller = new AbortController();
  request = controller;
  status.textContent = 'Đang tải video để phát liền mạch · 0%';
  streamButton.hidden = false;
  streamButton.onclick = () => {
   controller.abort();
   request = undefined;
   streamButton.hidden = true;
   status.textContent = 'Đang mở luồng phát video.';
   playSource(url, true);
  };

  try {
   const response = await fetch(url, {signal: controller.signal});
   if (!response.ok || !response.body) throw Error('Video unavailable');
   const reader = response.body.getReader();
   const chunks = [];
   let received = 0;
   let percent = 0;
   try {
    for (;;) {
     const {done, value} = await reader.read();
     controller.signal.throwIfAborted();
     if (done) break;
     received += value.byteLength;
     if (received > size) throw Error('Unexpected video size');
     chunks.push(value);
     const nextPercent = Math.floor(received * 100 / size);
     if (nextPercent !== percent) {
      percent = nextPercent;
      status.textContent = 'Đang tải video để phát liền mạch · ' + percent + '%';
     }
    }
   } finally {
    await reader.cancel().catch(() => {});
   }
   controller.signal.throwIfAborted();
   if (received !== size) throw Error('Incomplete video');
   objectUrl = URL.createObjectURL(new Blob(chunks, {type: response.headers.get('Content-Type') || ''}));
   playSource(objectUrl, autoplay);
  } catch {
   if (!controller.signal.aborted) {
    status.textContent = 'Đang mở luồng phát video.';
    playSource(url, autoplay);
   }
  } finally {
   if (request === controller) {
    request = undefined;
    streamButton.hidden = true;
   }
  }
 }

 return {start, stop};
}

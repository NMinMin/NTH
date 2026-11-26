function createVideoPlayback(player, streamButton) {
 const maxBufferedSize = 128 * 1024 * 1024;
 const maxCachedSize = 256 * 1024 * 1024;
 const cache = new Map();
 let cachedSize = 0;
 const loading = player.parentElement.querySelector('.video-loading');
 let request;
 let objectUrl;

 function hideLoading() { loading.hidden = true; }
 player.addEventListener('loadeddata', hideLoading);
 player.addEventListener('error', hideLoading);

 function stop() {
  request?.abort();
  request = undefined;
  loading.hidden = true;
  streamButton.hidden = true;
  player.pause();
  player.removeAttribute('src');
  player.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
 }

 function playSource(url, autoplay) {
  loading.hidden = false;
  player.preload = 'auto';
  player.src = url;
  if (autoplay) player.play().catch(() => {});
 }

 function remember(key, blob) {
  if (cache.has(key)) cachedSize -= cache.get(key).size;
  cache.delete(key);
  cache.set(key, blob);
  cachedSize += blob.size;
  for (const [oldKey, oldBlob] of cache) {
   if (cachedSize <= maxCachedSize) break;
   cache.delete(oldKey);
   cachedSize -= oldBlob.size;
  }
 }

 function clear() {
  stop();
  cache.clear();
  cachedSize = 0;
 }

 async function start(video, url, autoplay) {
  stop();
  const size = Number(video.size);
  if (!(size > 0 && size <= maxBufferedSize)) {
   playSource(url, autoplay);
   return;
  }

  const controller = new AbortController();
  request = controller;
  loading.hidden = false;
  streamButton.hidden = false;
  streamButton.onclick = () => {
   controller.abort();
   request = undefined;
   streamButton.hidden = true;
   playSource(url, true);
  };

  try {
   const key = video.id || url;
   let blob = cache.get(key);
   if (blob?.size === size) {
    const access = await fetch(url, {method: 'HEAD', signal: controller.signal});
    if (!access.ok) throw Error('Video unavailable');
   } else {
    blob = await loadBlob(url, size, controller.signal);
   }
   controller.signal.throwIfAborted();
   remember(key, blob);
   objectUrl = URL.createObjectURL(blob);
   playSource(objectUrl, autoplay);
  } catch {
   if (!controller.signal.aborted) {
    playSource(url, autoplay);
   }
  } finally {
   if (request === controller) {
    request = undefined;
    streamButton.hidden = true;
   }
  }
 }

 async function loadBlob(url, size, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok || !response.body) throw Error('Video unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
   for (;;) {
    const {done, value} = await reader.read();
    signal.throwIfAborted();
    if (done) break;
    received += value.byteLength;
    if (received > size) throw Error('Unexpected video size');
    chunks.push(value);
   }
  } finally {
   await reader.cancel().catch(() => {});
  }
  if (received !== size) throw Error('Incomplete video');
  return new Blob(chunks, {type: response.headers.get('Content-Type') || ''});
 }

 return {start, stop, clear};
}

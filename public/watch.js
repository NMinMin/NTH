const player = document.getElementById('sharedPlayer');
const title = document.getElementById('watchTitle');
const status = document.getElementById('watchStatus');
const download = document.getElementById('sharedDownload');

player.addEventListener('loadedmetadata', () => {
 const { videoWidth: width, videoHeight: height } = player;
 status.textContent = width && height
  ? videoQuality(width, height) + ' · ' + width + ' × ' + height + ' · Bản gốc'
  : 'Bản gốc';
});

player.addEventListener('error', () => {
 status.textContent = 'Không phát được video. Link có thể đã bị thu hồi hoặc trình duyệt không hỗ trợ định dạng này.';
});

async function openSharedVideo() {
 const token = location.hash.slice(1);
 if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  status.textContent = 'Link chia sẻ không hợp lệ.';
  return;
 }
 const endpoint = '/api/shared/' + token;
 try {
  const response = await fetch(endpoint);
  if (response.status === 404) {
   status.textContent = 'Video không còn được chia sẻ hoặc link đã bị thu hồi.';
   return;
  }
  if (!response.ok) throw Error('Cannot load video');
  const video = await response.json();
  title.textContent = video.name;
  document.title = video.name + ' | NTH Video';
  const mediaUrl = endpoint + '/media';
  download.href = mediaUrl + '?download=1';
  download.download = video.name;
  download.hidden = false;
  player.src = mediaUrl;
  player.hidden = false;
 } catch {
  status.textContent = 'Không thể mở video lúc này. Vui lòng thử lại.';
 }
}
openSharedVideo();


const player = document.getElementById('sharedPlayer');
const title = document.getElementById('watchTitle');
const status = document.getElementById('watchStatus');
const download = document.getElementById('sharedDownload');
const fileList = document.getElementById('sharedFolderFiles');
const videoTitle = document.getElementById('sharedVideoTitle');

player.addEventListener('loadedmetadata', () => {
 const { videoWidth: width, videoHeight: height } = player;
 status.textContent = width && height
  ? videoQuality(width, height) + ' · ' + width + ' × ' + height + ' · Bản gốc'
  : 'Bản gốc';
});

player.addEventListener('error', () => {
 status.textContent = 'Không phát được video. Link có thể đã bị thu hồi hoặc trình duyệt không hỗ trợ định dạng này.';
});

function showVideo(video, mediaUrl) {
 status.textContent = 'Đang tải thông tin video…';
 download.href = mediaUrl + '?download=1';
 download.download = video.name;
 download.hidden = false;
 player.src = mediaUrl;
 player.hidden = false;
}

function showFolder(folder, endpoint) {
 if (!folder.videos.length) {
  status.textContent = 'Thư mục chưa có video.';
  return;
 }
 const buttons = folder.videos.map(video => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = video.name;
  button.setAttribute('aria-pressed', 'false');
  button.onclick = () => {
   if (button.getAttribute('aria-pressed') === 'true') return;
   fileList.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
   button.setAttribute('aria-pressed', 'true');
   videoTitle.textContent = video.name;
   videoTitle.hidden = false;
   showVideo(video, endpoint + '/videos/' + video.id + '/media');
  };
  return button;
 });
 fileList.replaceChildren(...buttons);
 fileList.hidden = false;
 buttons[0].click();
}

async function openSharedItem() {
 const token = location.hash.slice(1);
 if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  status.textContent = 'Link chia sẻ không hợp lệ.';
  return;
 }
 const isFolder = location.pathname.replace(/\/$/, '') === '/watch/folder';
 const endpoint = (isFolder ? '/api/shared-folders/' : '/api/shared/') + token;
 try {
  const response = await fetch(endpoint);
  if (response.status === 404) {
   status.textContent = 'Link chia sẻ không còn hiệu lực.';
   return;
  }
  if (!response.ok) throw Error('Cannot load shared item');
  const item = await response.json();
  title.textContent = item.name;
  document.title = item.name + ' | NTH Video';
  if (isFolder) showFolder(item, endpoint);
  else showVideo(item, endpoint + '/media');
 } catch {
  status.textContent = 'Không thể mở link lúc này. Vui lòng thử lại.';
 }
}
openSharedItem();

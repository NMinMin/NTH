const byId = id => document.getElementById(id);
const player = byId('sharedPlayer');
const title = byId('watchTitle');
const status = byId('watchStatus');
const download = byId('sharedDownload');
const fileList = byId('sharedFolderFiles');
const playback = byId('sharedPlayback');
const playerStatus = byId('sharedPlayerStatus');
const preview = byId('sharedPreview');
const videoPlayback = createVideoPlayback(player, byId('sharedStream'));

fileBrowser.bindLayout(byId('sharedLayout'), fileList);
byId('closeSharedPreview').onclick = () => preview.close();
preview.addEventListener('close', videoPlayback.stop);

player.addEventListener('loadedmetadata', () => {
 const {videoWidth:width, videoHeight:height} = player;
 playerStatus.textContent = width && height
  ? videoQuality(width, height) + ' · ' + width + ' x ' + height + ' · Bản gốc'
  : 'Bản gốc';
});

player.addEventListener('error', () => {
 playerStatus.textContent = 'Không phát được video. Link có thể đã bị thu hồi hoặc trình duyệt không hỗ trợ định dạng này.';
});

function showVideo(video, mediaUrl, autoplay = false) {
 playerStatus.textContent = '';
 download.href = mediaUrl + '?download=1';
 download.download = video.name;
 playback.hidden = false;
 videoPlayback.start(video, mediaUrl, autoplay);
}

function showFolder(folder, endpoint) {
 byId('sharedFolder').hidden = false;
 byId('sharedCount').textContent = folder.videos.length + ' video';
 byId('sharedEmpty').hidden = !!folder.videos.length;
 preview.append(playback);
 fileList.replaceChildren(...folder.videos.map(video => {
  const mediaUrl = endpoint + '/videos/' + video.id + '/media';
  return fileBrowser.videoCard(video, {
   open:() => {
    byId('sharedVideoTitle').textContent = video.name;
    preview.showModal();
    showVideo(video, mediaUrl, true);
   },
   options:[{label:'Tải bản gốc', href:mediaUrl + '?download=1'}]
  });
 }));
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
  status.hidden = true;
 } catch {
  status.textContent = 'Không thể mở link lúc này. Vui lòng thử lại.';
 }
}
openSharedItem();

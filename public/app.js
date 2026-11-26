const $=id=>document.getElementById(id);
let sb,session,library={folders:[],videos:[]},folder=null,signup=false,naming=null,currentVideo=null,busy=false;
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500)}
function fail(e){toast(e.message||'Có lỗi xảy ra.')}
async function token(){const {data,error}=await sb.auth.getSession();if(error)throw error;if(!data.session)throw Error('Vui lòng đăng nhập lại.');return data.session.access_token}
async function api(url,options={}){
 const r=await fetch('/api'+url,{...options,headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json',...options.headers}});
 if(!r.ok){let d;try{d=await r.json()}catch{}throw Error(d?.error||'Không thể xử lý yêu cầu ('+r.status+').')}
 return r.json();
}
const {element, card, videoCard, bindLayout} = fileBrowser;
bindLayout($('libraryLayout'), $('folderGrid'), $('videoGrid'));

function selectFolder(id) {
 folder = id;
 $('search').value = '';
 render();
 $('pageTitle').focus();
}

const pendingFolderDeletes = new Set();

async function deleteFolder(item, button) {
 if (pendingFolderDeletes.has(item.id)) return;
 if (!window.confirm('Xóa thư mục "' + item.name + '" và toàn bộ video bên trong khỏi thư viện và nhánh lưu trữ trên GitHub? Các link chia sẻ sẽ ngừng hoạt động.')) return;

 pendingFolderDeletes.add(item.id);
 button.disabled = true;
 try {
  await api('/folders/' + item.id, {method:'DELETE'});
  library.folders = library.folders.filter(entry => entry.id !== item.id);
  library.videos = library.videos.filter(video => video.folder_id !== item.id);
  if (folder === item.id) selectFolder(null);
  else render();
  toast('Đã xóa thư mục và video bên trong khỏi thư viện và nhánh lưu trữ trên GitHub.');
 } catch (error) {
  await load().catch(() => {});
  fail(error);
 } finally {
  pendingFolderDeletes.delete(item.id);
  button.disabled = false;
 }
}

function renameFolder(item) {
 askName('Đổi tên thư mục', item.name, async name => {
  await api('/folders/' + item.id, {method:'PATCH', body:JSON.stringify({name})});
  await load();
 });
}

function render() {
 const selected = library.folders.find(item => item.id === folder);
 $('pageTitle').textContent = selected?.name || 'Trang chủ';
 $('folderPath').hidden = !selected;
 $('renameFolder').hidden = !selected;
 $('shareFolder').hidden = !selected;
 $('deleteFolder').hidden = !selected;
 $('search').placeholder = selected ? 'Tìm video trong thư mục' : 'Tìm video hoặc thư mục';
 $('search').setAttribute('aria-label', $('search').placeholder);
 $('videoSectionTitle').textContent = selected ? 'Video trong thư mục' : 'Video đã tải lên';

 const home = $('allVideos');
 home.classList.toggle('active', !selected);
 home.setAttribute('aria-current', selected ? 'false' : 'page');
 const navigation = library.folders.map(item => {
  const active = item.id === folder;
  const button = element('button', 'nav' + (active ? ' active' : ''), item.name);
  button.title = item.name;
  button.setAttribute('aria-current', active ? 'page' : 'false');
  button.onclick = () => selectFolder(item.id);
  return button;
 });
 $('folderNav').replaceChildren(...navigation);

 const search = $('search').value.trim().toLocaleLowerCase('vi');
 const matches = name => name.toLocaleLowerCase('vi').includes(search);
 const folders = selected ? [] : library.folders.filter(item => matches(item.name));
 const from = $('fromDate').value;
 const to = $('toDate').value;
 const sort = $('sort').value;
 const folderNames = new Map(library.folders.map(item => [item.id, item.name]));
 const counts = new Map();
 const videos = library.videos.filter(video => {
  counts.set(video.folder_id, (counts.get(video.folder_id) || 0) + 1);
  if ((selected && video.folder_id !== folder) || !matches(video.name)) return false;
  const date = new Date(video.created_at);
  const localDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return (!from || localDate >= from) && (!to || localDate <= to);
 });
 videos.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'vi')
  : (sort === 'old' ? 1 : -1) * (new Date(a.created_at) - new Date(b.created_at)));

 $('librarySummary').textContent = (selected ? '' : folders.length + ' thư mục · ') + videos.length + ' video';
 $('folderSection').hidden = !folders.length;
 $('folderGrid').replaceChildren(...folders.map(item => card({
  name:item.name, type:'folder', meta:(counts.get(item.id) || 0) + ' video',
  open:() => selectFolder(item.id),
  options:[
   {label:'Đổi tên', action:() => renameFolder(item)},
   {label:'Chia sẻ', action:() => openSharing(item, 'folders').catch(fail)},
   {label:'Xóa thư mục', danger:true, action:button => deleteFolder(item, button)}
  ]
 })));
 $('videoSection').hidden = !videos.length;
 $('videoGrid').replaceChildren(...videos.map(video => {
  const ready = video.status === 'ready';
  const states = {failed:'Tải thất bại', uploading:'Đang lưu', deleting:'Đang xóa dở'};
  const extra = [!selected && folderNames.get(video.folder_id), states[video.status]].filter(Boolean).join(' · ');
  return videoCard(video, {
   extra,
   open:ready && (() => play(video).catch(fail)),
   options:[
    {label:'Đổi tên', disabled:video.status === 'deleting', action:() => askName('Đổi tên video', video.name, async name => {
     await api('/videos/' + video.id, {method:'PATCH', body:JSON.stringify({name})});
     await load();
    })},
    {label:'Chia sẻ', disabled:!ready, action:() => openSharing(video).catch(fail)},
    {label:'Tải bản gốc', disabled:!ready, action:() => downloadVideo(video).catch(fail)},
    {label:video.status === 'deleting' ? 'Thử xóa lại' : 'Xóa video', danger:true,
     action:button => deleteVideo(video, button)}
   ]
  });
 }));
 const empty = $('emptyState');
 empty.hidden = !!(folders.length || videos.length);
 empty.textContent = search || from || to ? 'Không tìm thấy mục phù hợp.'
  : selected ? 'Thư mục này chưa có video.' : 'Hãy tải video lên hoặc tạo thư mục để bắt đầu.';
}

async function deleteVideo(video, button) {
 if (video.status !== 'deleting' && !window.confirm(
  'Xóa “' + video.name + '” khỏi thư viện và nhánh lưu trữ trên GitHub? Link chia sẻ của video sẽ ngừng hoạt động.'
 )) return;

 button.disabled = true;
 try {
  await api('/videos/' + video.id, {method:'DELETE'});
  library.videos = library.videos.filter(item => item.id !== video.id);
  render();
  toast('Đã xóa video khỏi thư viện và nhánh lưu trữ trên GitHub.');
 } catch (error) {
  await load().catch(() => {});
  fail(error);
 } finally {
  button.disabled = false;
 }
}
async function load() {
 library = await api('/library');
 if (folder && !library.folders.some(item => item.id === folder)) folder = null;
 render();
}
function askName(title,value,action){naming=action;$('nameTitle').textContent=title;$('nameInput').value=value;$('nameDialog').showModal();$('nameInput').focus()}
$('nameForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await naming($('nameInput').value.trim());$('nameDialog').close()}catch(e){fail(e)}finally{b.disabled=false}};
$('cancelName').onclick=()=>$('nameDialog').close();
$('newFolder').onclick=()=>askName('Tạo thư mục','',async name=>{const f=await api('/folders',{method:'POST',body:JSON.stringify({name})});folder=f.id;$('search').value='';await load();$('pageTitle').focus()});
$('renameFolder').onclick = () => {
 const selected = library.folders.find(item => item.id === folder);
 if (selected) renameFolder(selected);
};
$('shareFolder').onclick = () => {
 const selected = library.folders.find(item => item.id === folder);
 if (selected) openSharing(selected, 'folders').catch(fail);
};
$('deleteFolder').onclick = event => {
 const selected = library.folders.find(item => item.id === folder);
 if (selected) deleteFolder(selected, event.currentTarget);
};
$('allVideos').onclick = $('backHome').onclick = () => selectFolder(null);
for(const id of ['search','fromDate','toDate','sort'])$(id).addEventListener('input',render);
$('clearFilters').onclick=()=>{$('search').value='';$('fromDate').value='';$('toDate').value='';$('sort').value='new';render()};
const shareDialog = $('shareDialog');
const shareLink = $('shareLink');

function showShareLink(path) {
 shareLink.value = path ? new URL(path, location.origin).href : '';
 $('activeShare').hidden = !path;
 $('createShare').hidden = !!path;
 const kind = $('shareStatus').dataset.kind;
 const sharedContent = kind === 'thư mục' ? 'mọi video trong thư mục này' : 'video này';
 $('shareStatus').textContent = path
  ? 'Ai có link đều có thể xem và tải ' + sharedContent + '.'
  : 'Tạo link để chia sẻ ' + kind + '.';
}

async function openSharing(item, table = 'videos') {
 const endpoint = '/' + table + '/' + item.id + '/share';
 const {path} = await api(endpoint);
 $('shareTitle').textContent = 'Chia sẻ ' + item.name;
 $('shareStatus').dataset.kind = table === 'folders' ? 'thư mục' : 'video';
 showShareLink(path);
 $('createShare').onclick = async () => {
  const button = $('createShare');
  button.disabled = true;
  try {
   const result = await api(endpoint, {method:'POST'});
   showShareLink(result.path);
  } catch (error) {
   $('shareStatus').textContent = error.message;
  } finally {
   button.disabled = false;
  }
 };
 $('revokeShare').onclick = async () => {
  const button = $('revokeShare');
  button.disabled = true;
  try {
   await api(endpoint, {method:'DELETE'});
   showShareLink(null);
   $('shareStatus').textContent = 'Đã thu hồi link chia sẻ.';
  } catch (error) {
   $('shareStatus').textContent = error.message;
  } finally {
   button.disabled = false;
  }
 };
 shareDialog.showModal();
}
$('closeShare').onclick = () => shareDialog.close();
$('copyShare').onclick = async () => {
 try {
  await navigator.clipboard.writeText(shareLink.value);
  $('shareStatus').textContent = 'Đã sao chép link.';
 } catch {
  shareLink.select();
  $('shareStatus').textContent = 'Sao chép link đang được chọn.';
 }
};

const player = $('player');
const playerDialog = $('playerDialog');
const fullscreen = $('playerFullscreen');
const videoPlayback = createVideoPlayback(player, $('playerNote'), $('playerStream'));
async function play(video) {
 const {url} = await api('/videos/'+video.id+'/link');
 currentVideo = video;
 $('playerTitle').textContent = video.name;
 $('playerNote').textContent = 'Đang tải video gốc…';
 fullscreen.hidden = true;
 if (!playerDialog.open) playerDialog.showModal();
 videoPlayback.start(video, url, true);
}
function updatePlaybackQuality() {
 const {videoWidth: width, videoHeight: height} = player;
 if (!playerDialog.open || !width || !height) return;
 $('playerNote').textContent = videoQuality(width, height) + ' · ' + width + ' × ' + height + ' · Bản gốc';
 fullscreen.hidden = !(document.fullscreenEnabled || player.webkitSupportsFullscreen);
}
player.addEventListener('loadedmetadata', updatePlaybackQuality);
player.addEventListener('resize', updatePlaybackQuality);
player.addEventListener('error', () => {
 if (!playerDialog.open) return;
 $('playerNote').textContent = 'Không phát được video. Hãy thử mở lại hoặc tải bản gốc.';
 fullscreen.hidden = true;
});
fullscreen.onclick = async () => {
 try {
  if (document.fullscreenEnabled && player.requestFullscreen) await player.requestFullscreen();
  else if (player.webkitSupportsFullscreen) player.webkitEnterFullscreen();
 } catch {
  $('playerNote').textContent = 'Không mở được toàn màn hình. Hãy thử nút toàn màn hình trên thanh điều khiển video.';
 }
};
$('closePlayer').onclick = () => playerDialog.close();
playerDialog.addEventListener('close', videoPlayback.stop);
async function downloadVideo(v){const {url}=await api('/videos/'+v.id+'/link');const a=element('a');a.href=url+'&download=1';a.download=v.name;document.body.append(a);a.click();a.remove()}
$('playerDownload').onclick=()=>downloadVideo(currentVideo).catch(fail);
function metadata(file){return new Promise(resolve=>{const v=document.createElement('video');const url=URL.createObjectURL(file);const done=()=>{clearTimeout(timer);const data={width:v.videoWidth||'',height:v.videoHeight||'',duration:Number.isFinite(v.duration)?v.duration:''};v.removeAttribute('src');v.load();URL.revokeObjectURL(url);resolve(data)};const timer=setTimeout(done,5000);v.onloadedmetadata=done;v.onerror=done;v.preload='metadata';v.src=url})}
function uploadOne(data,accessToken){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/videos');xhr.setRequestHeader('Authorization','Bearer '+accessToken);xhr.upload.onprogress=e=>{if(e.lengthComputable){$('uploadProgress').value=e.loaded/e.total*100;if(e.loaded===e.total)$('uploadStatus').textContent='Đang lưu các phần video lên GitHub…'}};xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else{let d;try{d=JSON.parse(xhr.responseText)}catch{}reject(Error(d?.error||'Tải lên thất bại ('+xhr.status+').'))}};xhr.onerror=()=>reject(Error('Mất kết nối. Kiểm tra thư viện trước khi tải lại.'));xhr.send(data)})}
async function uploadFiles(files){
 if(busy)return toast('Vui lòng chờ lượt tải hiện tại hoàn tất.');if(!files.length)return;
 busy=true;$('uploadButton').disabled=true;$('uploadPanel').hidden=false;
 const targetFolder=folder;let success=0;
 try{for(const file of files){
  if(file.size>window.maxUploadMB*1048576){toast(file.name+': vượt giới hạn '+window.maxUploadMB+' MB');continue}
  const mime=file.type||(/\.mkv$/i.test(file.name)?'video/x-matroska':'');
  if(!['video/mp4','video/webm','video/quicktime','video/x-matroska'].includes(mime)){toast('Định dạng không hỗ trợ: '+file.name);continue}
  $('uploadStatus').textContent='Đang tải '+file.name;$('uploadProgress').value=0;
  const meta = await metadata(file);
  const data = new FormData();
  data.append('fileName', file.name);
  if (targetFolder) data.append('folderId', targetFolder);
  for (const [key, value] of Object.entries(meta)) data.append(key, value);
  data.append('video', new Blob([file], {type:mime}), file.name);
  try{await uploadOne(data,await token());success++}catch(e){toast(file.name+': '+e.message)}
 }$('uploadStatus').textContent='Hoàn tất '+success+'/'+files.length+' video.';await load();
 }catch(e){fail(e)}finally{busy=false;$('uploadButton').disabled=false;$('fileInput').value=''}
}
$('uploadButton').onclick=()=>$('fileInput').click();
$('dropZone').onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>uploadFiles([...e.target.files]);
for(const type of ['dragenter','dragover'])$('dropZone').addEventListener(type,e=>{e.preventDefault();$('dropZone').classList.add('drag')});
$('dropZone').addEventListener('dragleave',()=>$('dropZone').classList.remove('drag'));
$('dropZone').addEventListener('drop',e=>{e.preventDefault();$('dropZone').classList.remove('drag');uploadFiles([...e.dataTransfer.files])});
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue=''}});
const passwordInput = $('password');
const passwordToggle = $('togglePassword');

function showPassword(visible) {
 passwordInput.type = visible ? 'text' : 'password';
 passwordToggle.textContent = visible ? 'Ẩn' : 'Hiện';
 passwordToggle.setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
}
showPassword(false);
passwordToggle.onclick = () => showPassword(passwordInput.type === 'password');

$('switchAuth').onclick = () => {
 signup = !signup;
 $('authTitle').textContent = signup ? 'Tạo tài khoản' : 'Đăng nhập';
 $('authSubmit').textContent = signup ? 'Đăng ký' : 'Đăng nhập';
 $('switchAuth').textContent = signup ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký';
 passwordInput.autocomplete = signup ? 'new-password' : 'current-password';
 passwordInput.minLength = signup ? 8 : 0;
 passwordInput.placeholder = signup ? 'Ít nhất 8 ký tự' : '';
 showPassword(false);
 $('authMessage').textContent = '';
};

$('authForm').onsubmit = async event => {
 event.preventDefault();
 const submit = $('authSubmit');
 const switchMode = $('switchAuth');
 const message = $('authMessage');
 submit.disabled = true;
 switchMode.disabled = true;
 message.textContent = '';
 try {
  const credentials = {email:$('email').value.trim(), password:passwordInput.value};
  showPassword(false);
  const {data, error} = signup
   ? await sb.auth.signUp(credentials)
   : await sb.auth.signInWithPassword(credentials);
  if (error) throw error;
  if (!data.session) {
   message.textContent = 'Chưa thể đăng nhập ngay. Kiểm tra cài đặt xác nhận email của NTH Video.';
  } else {
   passwordInput.value = '';
  }
 } catch (error) {
  message.textContent = error.message;
 } finally {
  submit.disabled = false;
  switchMode.disabled = false;
 }
};
$('logout').onclick=async()=>{if(busy)return toast('Vui lòng đợi tải lên hoàn tất.');const {error}=await sb.auth.signOut();if(error)fail(error)};
async function showSession(s){session=s;$('authView').hidden=!!s;$('appView').hidden=!s;if(s){$('accountEmail').textContent=s.user.email;await load()}else{library={folders:[],videos:[]};folder=null;$('playerDialog').close()}}
(async()=>{try{const r=await fetch('/api/config');if(!r.ok)throw Error('Không kết nối được backend.');const config=await r.json();window.maxUploadMB=config.maxUploadMB;sb=window.supabase.createClient(config.supabaseUrl,config.supabaseKey);sb.auth.onAuthStateChange((event,s)=>{if(event==='INITIAL_SESSION'||event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(()=>showSession(s).catch(fail),0)})}catch(e){$('authMessage').textContent=e.message}})();


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
const bytes=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GB':(n/1048576).toFixed(1)+' MB';
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function selectFolder(id){folder=id;render()}
function render(){
 $('pageTitle').textContent=library.folders.find(f=>f.id===folder)?.name||'Tất cả video';
 $('renameFolder').hidden=!folder;
 $('shareFolder').hidden=!folder;
 $('folderNav').replaceChildren();
 for(const f of library.folders){const b=element('button','nav'+(folder===f.id?' active':''),'▱  '+f.name);b.onclick=()=>selectFolder(f.id);$('folderNav').append(b)}
 $('allVideos').classList.toggle('active',!folder);
 const ready=library.videos.filter(v=>v.status==='ready');
 $('totalCount').textContent=ready.length;$('videoCount').textContent=ready.length;$('storageSize').textContent=bytes(ready.reduce((n,v)=>n+Number(v.size),0));
 let list=library.videos.filter(v=>(!folder||v.folder_id===folder)&&v.name.toLocaleLowerCase().includes($('search').value.toLocaleLowerCase()));
 const from=$('fromDate').value,to=$('toDate').value;
 list=list.filter(v=>{const d=new Date(v.created_at);const date=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');return(!from||date>=from)&&(!to||date<=to)});
 list.sort((a,b)=>$('sort').value==='name'?a.name.localeCompare(b.name,'vi'):($('sort').value==='old'?1:-1)*(new Date(a.created_at)-new Date(b.created_at)));
 $('shownCount').textContent=list.length;$('videoGrid').replaceChildren();$('emptyState').hidden=!!list.length;
 for(const v of list){
  const card=element('article','video-card'),thumb=element('button','thumbnail');thumb.setAttribute('aria-label','Xem '+v.name);
  thumb.append(element('span','play','▷'),element('span','resolution',videoQuality(v.width,v.height)),element('span','duration',v.duration?Math.floor(v.duration/60)+':'+String(Math.floor(v.duration%60)).padStart(2,'0'):'VIDEO'));
  thumb.disabled=v.status!=='ready';thumb.onclick=()=>play(v).catch(fail);
  const info=element('div','video-info'),title=element('h3','',v.name);title.title=v.name;
  const state=v.status==='failed'?' · Tải thất bại':v.status==='uploading'?' · Đang lưu':'';
  info.append(title,element('div','meta',new Date(v.created_at).toLocaleDateString('vi-VN')+' · '+bytes(v.size)+state));
  const actions=element('div','card-actions'),rename=element('button','','Đổi tên'),download=element('button','','↓ Tải bản gốc');
  rename.onclick=()=>askName('Đổi tên video',v.name,async name=>{await api('/videos/'+v.id,{method:'PATCH',body:JSON.stringify({name})});await load()});
  download.disabled=v.status!=='ready';download.onclick=()=>downloadVideo(v).catch(fail);
  const share = element('button', '', 'Chia sẻ');
  share.disabled = v.status !== 'ready';
  share.onclick = () => openSharing(v).catch(fail);
  actions.append(rename, share, download);info.append(actions);card.append(thumb,info);$('videoGrid').append(card);
 }
}
async function load(){library=await api('/library');render()}
function askName(title,value,action){naming=action;$('nameTitle').textContent=title;$('nameInput').value=value;$('nameDialog').showModal();$('nameInput').focus()}
$('nameForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await naming($('nameInput').value.trim());$('nameDialog').close()}catch(e){fail(e)}finally{b.disabled=false}};
$('cancelName').onclick=()=>$('nameDialog').close();
$('newFolder').onclick=()=>askName('Tạo thư mục','',async name=>{const f=await api('/folders',{method:'POST',body:JSON.stringify({name})});folder=f.id;await load()});
$('renameFolder').onclick=()=>askName('Đổi tên thư mục',library.folders.find(f=>f.id===folder).name,async name=>{await api('/folders/'+folder,{method:'PATCH',body:JSON.stringify({name})});await load()});
$('shareFolder').onclick = () => {
 const selected = library.folders.find(item => item.id === folder);
 if (selected) openSharing(selected, 'folders').catch(fail);
};
$('allVideos').onclick=()=>selectFolder(null);
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
async function play(video) {
 const {url} = await api('/videos/'+video.id+'/link');
 currentVideo = video;
 $('playerTitle').textContent = video.name;
 $('playerNote').textContent = 'Đang tải video gốc…';
 fullscreen.hidden = true;
 player.src = url;
 if (!playerDialog.open) playerDialog.showModal();
 player.play().catch(() => {});
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
playerDialog.addEventListener('close', () => {
 player.pause();
 player.removeAttribute('src');
 player.load();
});
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
  const meta=await metadata(file),data=new FormData();data.append('video',new Blob([file],{type:mime}),file.name);if(targetFolder)data.append('folderId',targetFolder);for(const [key,value]of Object.entries(meta))data.append(key,value);
  try{await uploadOne(data,await token());success++}catch(e){toast(file.name+': '+e.message)}
 }$('uploadStatus').textContent='Hoàn tất '+success+'/'+files.length+' video.';await load();
 }catch(e){fail(e)}finally{busy=false;$('uploadButton').disabled=false;$('fileInput').value=''}
}
$('uploadButton').onclick=()=>$('fileInput').click();
$('dropZone').onclick=()=>$('fileInput').click();
$('dropZone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileInput').click()}};
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


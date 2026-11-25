import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import multer from 'multer';
import {createClient} from '@supabase/supabase-js';
import {mkdir,open,unlink} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {putChunk,getChunk,isPrivateVideoRepo,videoDirectory,deleteVideoChunks,checkVideoBranch,GitHubRequestError} from './github.js';
import {sign,verify,rangeOf} from './media.js';
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','GITHUB_TOKEN','GITHUB_OWNER','GITHUB_REPO','MEDIA_SIGNING_SECRET','APP_ORIGIN'];
for(const key of required)if(!process.env[key])throw Error('Missing '+key);
const secret=process.env.MEDIA_SIGNING_SECRET;
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=path.join(root,'tmp');await mkdir(tmp,{recursive:true});
const app=express();app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],connectSrc:["'self'",process.env.SUPABASE_URL],mediaSrc:["'self'",'blob:'],imgSrc:["'self'",'blob:','data:'],styleSrc:["'self'"]}},crossOriginResourcePolicy:{policy:'same-site'}}));
app.use(cors({origin:process.env.APP_ORIGIN.split(',').map(s=>s.trim()),exposedHeaders:['Content-Range','Content-Disposition','Accept-Ranges']}));
app.use(express.json({limit:'32kb'}));
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/config',(req,res)=>res.json({supabaseUrl:process.env.SUPABASE_URL,supabaseKey:process.env.SUPABASE_PUBLISHABLE_KEY,maxUploadMB:Number(process.env.MAX_UPLOAD_MB||2048)}));
app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false}));
async function auth(req,res,next){
 const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
 if(!token)return res.status(401).json({error:'Vui lòng đăng nhập.'});
 const {data,error}=await db.auth.getUser(token);
 if(error||!data.user)return res.status(401).json({error:'Phiên đăng nhập hết hạn.'});
 req.uid=data.user.id;next();
}
const check=(r)=>{if(r.error)throw Error('Không thể lưu dữ liệu: '+r.error.message);return r.data};
const nameOf=(value)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>180){const e=Error('Tên phải từ 1 đến 180 ký tự.');e.status=400;throw e}return value.trim()};
const filenameDecoder = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true});
function repairVideoName(name) {
 // Legacy uploads read UTF-8 filename header bytes as Latin-1.
 // Only reinterpret Latin-1 strings that contain a complete UTF-8 sequence.
 if (!/^[\u0000-\u00ff]*[\u0080-\u00ff][\u0000-\u00ff]*$/.test(name)) return name;
 try {
  return filenameDecoder.decode(Buffer.from(name, 'latin1'));
 } catch {
  return name;
 }
}
const uuid=(s)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||'');
app.get('/api/library',auth,async(req,res)=>{
 const [folders,videos]=await Promise.all([db.from('folders').select('id,name,created_at').eq('user_id',req.uid).order('name'),db.from('videos').select('id,folder_id,name,mime,size,width,height,duration,status,created_at').eq('user_id',req.uid).order('created_at',{ascending:false})]);
 const videoItems = check(videos).map(video => ({...video, name:repairVideoName(video.name)}));
 res.json({folders:check(folders),videos:videoItems});
});
app.post('/api/folders',auth,async(req,res)=>res.status(201).json(check(await db.from('folders').insert({user_id:req.uid,name:nameOf(req.body.name)}).select('id,name,created_at').single())));
for(const table of ['videos','folders'])app.patch('/api/'+table+'/:id',auth,async(req,res)=>{
 if(!uuid(req.params.id))return res.sendStatus(400);
 const r=check(await db.from(table).update({name:nameOf(req.body.name)}).eq('id',req.params.id).eq('user_id',req.uid).select('id,name').maybeSingle());
 if(!r)return res.sendStatus(404);res.json(r);
});
const upload=multer({dest:tmp,limits:{fileSize:Number(process.env.MAX_UPLOAD_MB||2048)*1024*1024,files:1,fields:5},fileFilter(req,file,cb){cb(null,['video/mp4','video/webm','video/quicktime','video/x-matroska'].includes(file.mimetype))}});
function uploadGitHubMessage(error) {
 const {upstreamStatus: status, stage} = error;
 if (status === 401) return 'Token GitHub không hợp lệ hoặc đã hết hạn. Hãy cập nhật GITHUB_TOKEN trên Render.';
 if (status === 404 && stage === 'repo') return 'GitHub không tìm thấy repo lưu video hoặc token chưa được cấp quyền vào repo. Kiểm tra GITHUB_OWNER, GITHUB_REPO và quyền Contents: Read and write.';
 if (status === 404 && stage === 'branch') return 'Không tìm thấy nhánh lưu video trên GitHub. Kiểm tra GITHUB_BRANCH và tạo commit đầu tiên cho repo.';
 if (status === 403 || status === 404) return 'GitHub từ chối truy cập. Kiểm tra token có quyền Contents: Read and write cho repo lưu video và nhánh có cho phép ghi trực tiếp.';
 if (status === 409 || status === 422) return 'GitHub từ chối ghi video vào nhánh lưu trữ. Kiểm tra quy tắc bảo vệ nhánh hoặc thử lại.';
 if (!status || status === 429 || status >= 500) return 'GitHub chưa phản hồi hoặc đang giới hạn yêu cầu. Hãy thử tải lên lại.';
 return 'Không lưu được video lên GitHub. Kiểm tra Render Logs để biết mã lỗi.';
}
const active=new Set();
const deletingFolders = new Set();
app.post('/api/videos',auth,async(req,res,next)=>{
 if(active.has(req.uid)||active.size>=2)return res.status(429).json({error:'Đang xử lý video. Vui lòng thử lại sau.'});
 active.add(req.uid);
 upload.single('video')(req,res,async(err)=>{
 let id;let file;
 try{
  if(err)throw err;if(!req.file){const e=Error('Chọn video MP4, WebM, MOV hoặc MKV.');e.status=400;throw e}
  if(!req.file.size){const e=Error('Video rỗng.');e.status=400;throw e}
  const folder=req.body.folderId||null;
  if (folder && deletingFolders.has(req.uid + '/' + String(folder).toLowerCase())) {
   return res.status(409).json({error:'Thư mục đang được xóa.'});
  }
  if(folder&&(!uuid(folder)||!check(await db.from('folders').select('id').eq('id',folder).eq('user_id',req.uid).maybeSingle()))){const e=Error('Thư mục không tồn tại.');e.status=400;throw e}
  if (!(await isPrivateVideoRepo())) {
   return res.status(409).json({error:'Repo lưu video trên GitHub phải ở chế độ Private.'});
  }
  await checkVideoBranch();
  const videoId = randomUUID();
  const directory = videoDirectory(req.uid, videoId);
  const name = nameOf(req.body.fileName ?? repairVideoName(req.file.originalname));
  const dimension=k=>{const n=Number(req.body[k]);return Number.isFinite(n)&&n>0?n:null};
  check(await db.from('videos').insert({id:videoId,user_id:req.uid,folder_id:folder,name,mime:req.file.mimetype,size:req.file.size,width:dimension('width'),height:dimension('height'),duration:dimension('duration')}));
  id = videoId;
  file=await open(req.file.path,'r');const chunks=[];let position=0;const chunkSize=20*1024*1024;
  while(position<req.file.size){
   const buffer=Buffer.alloc(Math.min(chunkSize,req.file.size-position));let filled=0;
   while(filled<buffer.length){const {bytesRead}=await file.read(buffer,filled,buffer.length-filled,position+filled);if(!bytesRead)throw Error('Không đọc được video.');filled+=bytesRead}
   chunks.push(await putChunk(directory+'/'+String(chunks.length).padStart(5,'0')+'.part',buffer));
   check(await db.from('videos').update({chunks}).eq('id',id).eq('user_id',req.uid));position+=filled;
  }
  check(await db.from('videos').update({status:'ready'}).eq('id',id).eq('user_id',req.uid));
  res.status(201).json({id});
 }catch(e){
  if (id) {
   try {
    check(await db.from('videos').update({status:'failed'}).eq('id',id).eq('user_id',req.uid));
   } catch (markError) {
    console.error('Could not mark upload failed:', markError.message);
   }
  }
  if (e instanceof GitHubRequestError) {
   console.error('Video upload failed:', e.message);
   return res.status(502).json({error:uploadGitHubMessage(e)});
  }
  next(e);
 } finally {
  await file?.close().catch(() => {});
  if (req.file) await unlink(req.file.path).catch(() => {});
  active.delete(req.uid);
 }
 });
});
const deletingVideos = new Set();

async function removeStoredVideo(userId, id) {
 const operation = userId + '/' + id.toLowerCase();
 if (deletingVideos.has(operation)) return {status:409, error:'Video đang được xóa. Hãy thử lại.'};
 deletingVideos.add(operation);
 const owned = query => query.eq('id', id).eq('user_id', userId);
 try {
  const video = check(await owned(db.from('videos').select('id,status,chunks')).maybeSingle());
  if (!video) return {status:404, error:'Không tìm thấy video.'};
  if (video.status === 'uploading' && active.has(userId)) {
   return {status:409, error:'Đợi video tải lên xong rồi thử xóa lại.'};
  }
  const marked = check(await owned(db.from('videos').update({status:'deleting',share_token:null}))
   .eq('status', video.status).select('id').maybeSingle());
  if (!marked) return {status:409, error:'Trạng thái video đã thay đổi. Hãy thử lại.'};
  try {
   await deleteVideoChunks(userId, video.id, video.chunks);
  } catch (error) {
   console.error('GitHub video deletion failed:', error.message);
   return {status:502, error:'Chưa xóa hết video trên GitHub. Hãy thử xóa lại để tiếp tục.'};
  }
  check(await owned(db.from('videos').delete()).eq('status', 'deleting'));
  return null;
 } finally {
  deletingVideos.delete(operation);
 }
}

app.delete('/api/videos/:id', auth, async (req, res) => {
 const {id} = req.params;
 if (!uuid(id)) return res.sendStatus(404);
 const failure = await removeStoredVideo(req.uid, id);
 if (failure) return res.status(failure.status).json({error:failure.error});
 res.json({id:id.toLowerCase()});
});

app.delete('/api/folders/:id', auth, async (req, res) => {
 const {id} = req.params;
 const missing = () => res.status(404).json({error:'Không tìm thấy thư mục.'});
 if (!uuid(id)) return missing();

 const operation = req.uid + '/' + id.toLowerCase();
 if (deletingFolders.has(operation)) return res.status(409).json({error:'Thư mục đang được xóa.'});
 if (active.has(req.uid)) return res.status(409).json({error:'Đợi tải video lên xong rồi thử xóa thư mục lại.'});
 deletingFolders.add(operation);

 const owned = query => query.eq('id', id).eq('user_id', req.uid);
 try {
  if (!check(await owned(db.from('folders').select('id')).maybeSingle())) return missing();
  for (;;) {
   const videos = check(await db.from('videos').select('id')
    .eq('folder_id', id).eq('user_id', req.uid).order('id').limit(50));
   if (!videos.length) break;
   for (const video of videos) {
    const failure = await removeStoredVideo(req.uid, video.id);
    if (failure && failure.status !== 404) return res.status(failure.status).json({error:failure.error});
   }
  }

  const result = await owned(db.from('folders').delete()).select('id').maybeSingle();
  if (result.error?.code === '23503') {
   return res.status(409).json({error:'Thư mục vẫn còn video. Hãy thử xóa lại.'});
  }
  if (!check(result)) return missing();
  res.json({ok:true});
 } finally {
  deletingFolders.delete(operation);
 }
});

app.get('/api/videos/:id/link',auth,async(req,res)=>{
 const v=check(await db.from('videos').select('id').eq('id',req.params.id).eq('user_id',req.uid).eq('status','ready').maybeSingle());
 if(!v)return res.sendStatus(404);
 const exp=Math.floor(Date.now()/1000)+21600;
 res.json({url:'/api/media/'+v.id+'?uid='+req.uid+'&exp='+exp+'&sig='+sign(v.id,req.uid,exp,secret)});
});
for (const table of ['videos', 'folders']) {
 const endpoint = '/api/' + table + '/:id/share';
 const watchPath = table === 'videos' ? '/watch#' : '/watch/folder#';
 const sharePath = token => token ? watchPath + token : null;

 const owned = (query, req) => {
  const match = query.eq('id', req.params.id).eq('user_id', req.uid);
  return table === 'videos' ? match.eq('status', 'ready') : match;
 };
 app.use(endpoint, auth, (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  if (!uuid(req.params.id)) return res.sendStatus(404);
  next();
 });

 app.get(endpoint, async (req, res) => {
  const item = check(await owned(db.from(table).select('share_token'), req).maybeSingle());
  if (!item) return res.sendStatus(404);
  res.json({path: sharePath(item.share_token)});
 });

 app.post(endpoint, async (req, res) => {
  const token = randomBytes(32).toString('base64url');
  const created = check(await owned(db.from(table).update({share_token: token}), req)
   .is('share_token', null).select('share_token').maybeSingle());
  if (created) return res.status(201).json({path: sharePath(created.share_token)});
  const item = check(await owned(db.from(table).select('share_token'), req).maybeSingle());
  if (!item) return res.sendStatus(404);
  if (!item.share_token) return res.status(409).json({error:'Link vừa bị thu hồi. Hãy thử tạo lại.'});
  res.json({path: sharePath(item.share_token)});
 });

 app.delete(endpoint, async (req, res) => {
  const item = check(await owned(db.from(table).update({share_token: null}), req)
   .select('id').maybeSingle());
  if (!item) return res.sendStatus(404);
  res.json({path: null});
 });
}

async function sharedVideo(token, columns) {
 if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
 return check(await db.from('videos').select(columns).eq('share_token', token)
  .eq('status', 'ready').maybeSingle());
}

app.get('/api/shared/:token', async (req, res) => {
 res.set('Cache-Control', 'private, no-store');
 const video = await sharedVideo(req.params.token, 'name');
 if (!video) return res.sendStatus(404);
 res.json({name: repairVideoName(video.name)});
});

app.get('/api/shared/:token/media', async (req, res) => {
 res.set('Cache-Control', 'private, no-store');
 const video = await sharedVideo(req.params.token, 'name,mime,size,chunks');
 if (!video) return res.sendStatus(404);
 await streamVideo(req, res, video, req.query.download === '1');
});

async function sharedFolder(token) {
 if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
 return check(await db.from('folders').select('id,user_id,name').eq('share_token', token).maybeSingle());
}

function folderVideos(folder, columns) {
 return db.from('videos').select(columns)
  .eq('folder_id', folder.id).eq('user_id', folder.user_id).eq('status', 'ready');
}

app.get('/api/shared-folders/:token', async (req, res) => {
 res.set('Cache-Control', 'private, no-store');
 const folder = await sharedFolder(req.params.token);
 if (!folder) return res.sendStatus(404);
 const fields = 'id,name,size,width,height,duration,created_at';
 const videos = check(await folderVideos(folder, fields).order('created_at', {ascending:false}));
 res.json({name:folder.name, videos:videos.map(({id, name, size, width, height, duration, created_at}) => ({
  id, name:repairVideoName(name), size, width, height, duration, created_at
 }))});
});

app.get('/api/shared-folders/:token/videos/:id/media', async (req, res) => {
 res.set('Cache-Control', 'private, no-store');
 if (!uuid(req.params.id)) return res.sendStatus(404);
 const folder = await sharedFolder(req.params.token);
 if (!folder) return res.sendStatus(404);
 const video = check(await folderVideos(folder, 'name,mime,size,chunks').eq('id', req.params.id).maybeSingle());
 if (!video) return res.sendStatus(404);
 await streamVideo(req, res, video, req.query.download === '1');
});

app.get('/api/media/:id',async(req,res)=>{
 const {uid,exp,sig}=req.query;
 if(!uuid(req.params.id)||!uuid(uid)||!verify(req.params.id,uid,exp,sig,secret))return res.sendStatus(403);
 const v=check(await db.from('videos').select('*').eq('id',req.params.id).eq('user_id',uid).eq('status','ready').maybeSingle());
 if(!v)return res.sendStatus(404);
 await streamVideo(req, res, v, req.query.download === '1');
});

async function streamVideo(req, res, v, download = false) {
 let range;try{range=rangeOf(req.headers.range,Number(v.size))}catch{return res.status(416).set('Content-Range','bytes */'+v.size).end()}
 const {start,end,partial}=range;
 res.status(partial?206:200).set({'Content-Type':v.mime,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
 if(partial)res.set('Content-Range',`bytes ${start}-${end}/${v.size}`);
 if(download)res.set('Content-Disposition',"attachment; filename=\"video\"; filename*=UTF-8''"+encodeURIComponent(repairVideoName(v.name)).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)));
 if (req.method === 'HEAD') return res.end();
 const controller=new AbortController();res.on('close',()=>controller.abort());
 let offset=0;
 try{
  for(const chunk of v.chunks){
   const lo=Math.max(0,start-offset),hi=Math.min(chunk.size-1,end-offset);offset+=chunk.size;
   if(lo>hi)continue;
   const upstream=await getChunk(chunk.sha,controller.signal);const reader=upstream.body.getReader();let seen=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;const a=Math.max(0,lo-seen),b=Math.min(value.length,hi-seen+1);seen+=value.length;if(b>a&&!res.write(value.subarray(a,b)))await once(res,'drain',{signal:controller.signal});if(seen>hi)break}}finally{await reader.cancel().catch(()=>{})}
   if(offset>end)break;
  }res.end();
 }catch(e){if(!res.destroyed)res.destroy(e)}
}
app.get(['/watch', '/watch/folder'], (req, res) => {
 res.set('Cache-Control', 'private, no-store');
 res.sendFile(path.join(root, 'public', 'watch.html'));
});
app.use('/vendor',express.static(path.join(root,'node_modules/@supabase/supabase-js/dist/umd')));
app.use(express.static(path.join(root,'public')));
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);console.error(err.message);res.status(err.code==='LIMIT_FILE_SIZE'?413:err.status||500).json({error:err.code==='LIMIT_FILE_SIZE'?'Video vượt dung lượng cho phép.':err.status&&err.status<500?err.message:'Có lỗi khi xử lý. Kiểm tra cấu hình backend hoặc thử lại.'})});
const server=app.listen(process.env.PORT||3000,()=>console.log('NTH Video ready'));
server.requestTimeout=0;
server.headersTimeout=60000;


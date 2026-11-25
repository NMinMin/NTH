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
import {putChunk,getChunk,isPrivateVideoRepo} from './github.js';
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
const uuid=(s)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||'');
app.get('/api/library',auth,async(req,res)=>{
 const [folders,videos]=await Promise.all([db.from('folders').select('id,name,created_at').eq('user_id',req.uid).order('name'),db.from('videos').select('id,folder_id,name,mime,size,width,height,duration,status,created_at').eq('user_id',req.uid).order('created_at',{ascending:false})]);
 res.json({folders:check(folders),videos:check(videos)});
});
app.post('/api/folders',auth,async(req,res)=>res.status(201).json(check(await db.from('folders').insert({user_id:req.uid,name:nameOf(req.body.name)}).select('id,name,created_at').single())));
for(const table of ['videos','folders'])app.patch('/api/'+table+'/:id',auth,async(req,res)=>{
 if(!uuid(req.params.id))return res.sendStatus(400);
 const r=check(await db.from(table).update({name:nameOf(req.body.name)}).eq('id',req.params.id).eq('user_id',req.uid).select('id,name').maybeSingle());
 if(!r)return res.sendStatus(404);res.json(r);
});
const upload=multer({dest:tmp,limits:{fileSize:Number(process.env.MAX_UPLOAD_MB||2048)*1024*1024,files:1,fields:5},fileFilter(req,file,cb){cb(null,['video/mp4','video/webm','video/quicktime','video/x-matroska'].includes(file.mimetype))}});
const active=new Set();
app.post('/api/videos',auth,async(req,res,next)=>{
 if(active.has(req.uid)||active.size>=2)return res.status(429).json({error:'Đang xử lý video. Vui lòng thử lại sau.'});
 active.add(req.uid);
 upload.single('video')(req,res,async(err)=>{
 let id;let file;
 try{
  if(err)throw err;if(!req.file){const e=Error('Chọn video MP4, WebM, MOV hoặc MKV.');e.status=400;throw e}
  if(!req.file.size){const e=Error('Video rỗng.');e.status=400;throw e}
  const folder=req.body.folderId||null;
  if(folder&&(!uuid(folder)||!check(await db.from('folders').select('id').eq('id',folder).eq('user_id',req.uid).maybeSingle()))){const e=Error('Thư mục không tồn tại.');e.status=400;throw e}
  if (!(await isPrivateVideoRepo())) {
   return res.status(409).json({error:'Repo lưu video trên GitHub phải ở chế độ Private.'});
  }
  id=randomUUID();
  const dimension=k=>{const n=Number(req.body[k]);return Number.isFinite(n)&&n>0?n:null};
  check(await db.from('videos').insert({id,user_id:req.uid,folder_id:folder,name:nameOf(req.file.originalname),mime:req.file.mimetype,size:req.file.size,width:dimension('width'),height:dimension('height'),duration:dimension('duration')}));
  file=await open(req.file.path,'r');const chunks=[];let position=0;const chunkSize=20*1024*1024;
  while(position<req.file.size){
   const buffer=Buffer.alloc(Math.min(chunkSize,req.file.size-position));let filled=0;
   while(filled<buffer.length){const {bytesRead}=await file.read(buffer,filled,buffer.length-filled,position+filled);if(!bytesRead)throw Error('Không đọc được video.');filled+=bytesRead}
   const prefix=(process.env.GITHUB_FOLDER||'videos').replace(/^\/+|\/+$/g,'');
   if(!/^[a-zA-Z0-9_/-]+$/.test(prefix)||prefix.includes('..'))throw Error('GITHUB_FOLDER không hợp lệ.');
   chunks.push(await putChunk(prefix+'/'+req.uid+'/'+id+'/'+String(chunks.length).padStart(5,'0')+'.part',buffer));
   check(await db.from('videos').update({chunks}).eq('id',id).eq('user_id',req.uid));position+=filled;
  }
  check(await db.from('videos').update({status:'ready'}).eq('id',id).eq('user_id',req.uid));
  res.status(201).json({id});
 }catch(e){
  if(id)await db.from('videos').update({status:'failed'}).eq('id',id).eq('user_id',req.uid);
  next(e);
 }finally{await file?.close();if(req.file)await unlink(req.file.path).catch(()=>{});active.delete(req.uid)}
 });
});
app.get('/api/videos/:id/link',auth,async(req,res)=>{
 const v=check(await db.from('videos').select('id').eq('id',req.params.id).eq('user_id',req.uid).eq('status','ready').maybeSingle());
 if(!v)return res.sendStatus(404);
 const exp=Math.floor(Date.now()/1000)+21600;
 res.json({url:'/api/media/'+v.id+'?uid='+req.uid+'&exp='+exp+'&sig='+sign(v.id,req.uid,exp,secret)});
});
const sharePath = token => token ? '/watch#' + token : null;

app.use('/api/videos/:id/share', auth, (req, res, next) => {
 res.set('Cache-Control', 'private, no-store');
 if (!uuid(req.params.id)) return res.sendStatus(404);
 next();
});

function ownedShareQuery(query, req) {
 return query.eq('id', req.params.id).eq('user_id', req.uid).eq('status', 'ready');
}

app.get('/api/videos/:id/share', async (req, res) => {
 const video = check(await ownedShareQuery(db.from('videos').select('share_token'), req).maybeSingle());
 if (!video) return res.sendStatus(404);
 res.json({path: sharePath(video.share_token)});
});

app.post('/api/videos/:id/share', async (req, res) => {
 const token = randomBytes(32).toString('base64url');
 const created = check(await ownedShareQuery(db.from('videos').update({share_token: token}), req)
  .is('share_token', null).select('share_token').maybeSingle());
 if (created) return res.status(201).json({path: sharePath(created.share_token)});
 const video = check(await ownedShareQuery(db.from('videos').select('share_token'), req).maybeSingle());
 if (!video) return res.sendStatus(404);
 if (!video.share_token) return res.status(409).json({error:'Link vừa bị thu hồi. Hãy thử tạo lại.'});
 res.json({path: sharePath(video.share_token)});
});

app.delete('/api/videos/:id/share', async (req, res) => {
 const video = check(await ownedShareQuery(db.from('videos').update({share_token: null}), req)
  .select('id').maybeSingle());
 if (!video) return res.sendStatus(404);
 res.json({path: null});
});

async function sharedVideo(token, columns) {
 if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
 return check(await db.from('videos').select(columns).eq('share_token', token)
  .eq('status', 'ready').maybeSingle());
}

app.get('/api/shared/:token', async (req, res) => {
 res.set('Cache-Control', 'private, no-store');
 const video = await sharedVideo(req.params.token, 'name');
 if (!video) return res.sendStatus(404);
 res.json({name: video.name});
});

app.get('/api/shared/:token/media', async (req, res) => {
 res.set('Cache-Control', 'private, no-store');
 const video = await sharedVideo(req.params.token, 'name,mime,size,chunks');
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
 if(download)res.set('Content-Disposition',"attachment; filename=\"video\"; filename*=UTF-8''"+encodeURIComponent(v.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)));
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
app.get('/watch', (req, res) => {
 res.set('Cache-Control', 'private, no-store');
 res.sendFile(path.join(root, 'public', 'watch.html'));
});
app.use('/vendor',express.static(path.join(root,'node_modules/@supabase/supabase-js/dist/umd')));
app.use(express.static(path.join(root,'public')));
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);console.error(err.message);res.status(err.code==='LIMIT_FILE_SIZE'?413:err.status||500).json({error:err.code==='LIMIT_FILE_SIZE'?'Video vượt dung lượng cho phép.':err.status&&err.status<500?err.message:'Có lỗi khi xử lý. Kiểm tra cấu hình backend hoặc thử lại.'})});
const server=app.listen(process.env.PORT||3000,()=>console.log('NTH Video ready'));
server.requestTimeout=0;
server.headersTimeout=60000;


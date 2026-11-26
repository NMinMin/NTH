// This fixture is loaded only by the API integration test.
const realFetch=globalThis.fetch;
const uid='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const rows=[{id,user_id:uid,name:Buffer.from('Nghịch Thủy Hàn.mp4','utf8').toString('latin1'),mime:'video/mp4',size:10,status:'ready',chunks:[{sha:'chunk1',size:5},{sha:'chunk2',size:5}]}];
let repositoryChecks = 0;
const playbackReads = new Set();
let finishFirstPart;
let failSecondDelete = true;
const trackedFiles = new Map();
const folders=[];const blobs=new Map([['chunk1',Buffer.from('abcde')],['chunk2',Buffer.from('fghij')]]);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url),method=options.method||'GET';
 if(url.hostname==='example.supabase.co'){
  if(url.pathname==='/auth/v1/user') {
   const token = new Headers(options.headers).get('authorization');
   if (token === 'Bearer valid-token') return json({id:uid,email:'test@example.com'});
   if (token === 'Bearer other-token') return json({id:'33333333-3333-4333-8333-333333333333',email:'other@example.com'});
   return json({message:'Invalid JWT'},401);
  }
  if(url.pathname.startsWith('/rest/v1/')){
   const isFolder=url.pathname.endsWith('/folders'),table=isFolder?folders:rows;
   const selected=()=>table.filter(r=>[...url.searchParams].every(([k,v])=>{
    if (v === 'is.null') return r[k] == null;
    return !v.startsWith('eq.') || String(r[k]) === v.slice(3);
   }));
   if(method==='POST'){const body=JSON.parse(options.body);const r={id:body.id||'44444444-4444-4444-8444-444444444444',status:'uploading',chunks:[],...body};table.push(r);return new Headers(options.headers).get('prefer')?.includes('return=representation')?json(r):new Response(null,{status:201})}
   if(method==='PATCH'){const matched=selected();for(const r of matched)Object.assign(r,JSON.parse(options.body));return new Headers(options.headers).get('prefer')?.includes('return=representation')?json(matched):new Response(null,{status:204})}
   if (method === 'DELETE') {
    const matched = selected();
    for (const row of matched) {
     if (isFolder && rows.some(video => video.folder_id === row.id && video.user_id === row.user_id)) {
      return json({code:'23503',message:'Folder still contains videos'},409);
     }
     if (row.chunks?.some(chunk => trackedFiles.has(chunk.path))) {
      return json({message:'GitHub still contains video parts'},409);
     }
     table.splice(table.indexOf(row), 1);
    }
    return new Headers(options.headers).get('prefer')?.includes('return=representation')
     ? json(matched.map(({id}) => ({id})))
     : new Response(null, {status:204});
   }
   const limit = Number(url.searchParams.get('limit')) || table.length;
   return json(selected().slice(0,limit));
  }
  throw Error('Unexpected Supabase path '+url.pathname);
 }
 if(url.hostname==='api.github.com'){
  if (method === 'GET' && url.pathname === '/repos/owner/repo') {
   repositoryChecks++;
   if (repositoryChecks === 1) return json({message:'Not Found'},404);
   return json({private:repositoryChecks > 2});
  }
  if (url.pathname === '/repos/owner/repo/branches/main') return json({name:'main'});
  const contentsPrefix = '/repos/owner/repo/contents/';
  if (url.pathname.startsWith(contentsPrefix)) {
   const filePath = url.pathname.slice(contentsPrefix.length);
   if (method === 'GET') {
    if (url.searchParams.get('ref') !== 'main') return json({message:'Unexpected branch'},400);
    const dirFiles = [...trackedFiles].filter(([path]) => path.slice(0,path.lastIndexOf('/')) === filePath);
    return dirFiles.length
     ? json(dirFiles.map(([path,sha]) => ({name:path.split('/').pop(),path,sha,type:'file'})))
     : json({message:'Missing directory'},404);
   }
   if (method === 'DELETE') {
    const {sha,branch} = JSON.parse(options.body);
    if (branch !== 'main' || trackedFiles.get(filePath) !== sha) return json({message:'Unexpected delete'},409);
    if (filePath.endsWith('/00001.part') && failSecondDelete) {
     failSecondDelete = false;
     return json({message:'Simulated failure'},503);
    }
    trackedFiles.delete(filePath);
    return json({content:null});
   }
  }
  if(method==='PUT'&&url.pathname.includes('/contents/')){
   const body=JSON.parse(options.body),buffer=Buffer.from(body.content,'base64'),sha='uploaded'+blobs.size;
   trackedFiles.set(url.pathname.slice(contentsPrefix.length),sha);
   blobs.set(sha,buffer);return json({content:{sha}});
  }
  const sha = url.pathname.split('/').pop();
  // The first full playback can finish only if the next part is requested
  // while the first response body is still in progress.
  if (sha === 'chunk1' || sha === 'chunk2') {
   if (playbackReads.has(sha)) throw Error('Playback fetched the same GitHub part twice');
   playbackReads.add(sha);
  }
  if (sha === 'chunk1') {
   return new Response(new ReadableStream({
    start(controller) {
     controller.enqueue(blobs.get(sha).subarray(0, 2));
     finishFirstPart = () => {
      controller.enqueue(blobs.get(sha).subarray(2));
      controller.close();
     };
    },
    cancel() { finishFirstPart = undefined; }
   }));
  }
  if (sha === 'chunk2' && finishFirstPart) {
   finishFirstPart();
   finishFirstPart = undefined;
  }
  if (blobs.has(sha)) return new Response(blobs.get(sha));
  throw Error('Unexpected GitHub path '+url.pathname);
 }
 return realFetch(input,options);
};


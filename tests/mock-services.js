// This fixture is loaded only by the API integration test.
const realFetch=globalThis.fetch;
const uid='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const rows=[{id,user_id:uid,name:'test.mp4',mime:'video/mp4',size:10,status:'ready',chunks:[{sha:'chunk1',size:5},{sha:'chunk2',size:5}]}];
let repositoryChecks = 0;
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
   const matched=selected();return json(matched);
  }
  throw Error('Unexpected Supabase path '+url.pathname);
 }
 if(url.hostname==='api.github.com'){
  if (method === 'GET' && url.pathname === '/repos/owner/repo') {
   return json({private: ++repositoryChecks > 1});
  }
  if(method==='PUT'&&url.pathname.includes('/contents/')){
   const body=JSON.parse(options.body),buffer=Buffer.from(body.content,'base64'),sha='uploaded'+blobs.size;
   blobs.set(sha,buffer);return json({content:{sha}});
  }
  const sha=url.pathname.split('/').pop();if(blobs.has(sha))return new Response(blobs.get(sha));
  throw Error('Unexpected GitHub path '+url.pathname);
 }
 return realFetch(input,options);
};


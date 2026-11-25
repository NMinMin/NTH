const base=()=>`https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`;
export async function github(path,options={}){
 const r=await fetch(base()+path,{...options,headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...options.headers},signal:options.signal??AbortSignal.timeout(180000)});
 if(!r.ok){const e=Error('GitHub HTTP '+r.status+'. Kiểm tra token, repo và giới hạn API.');e.status=502;throw e}return r;
}
export async function isPrivateVideoRepo() {
 const response = await github('');
 const repository = await response.json();
 return repository.private === true;
}
let queue=Promise.resolve();
export function putChunk(path,bytes){
 const task=queue.then(async()=>{const r=await github('/contents/'+path,{method:'PUT',body:JSON.stringify({message:'Store '+path,branch:process.env.GITHUB_BRANCH||'main',content:bytes.toString('base64')})});const d=await r.json();return {path,sha:d.content.sha,size:bytes.length}});
 queue=task.catch(()=>{});return task;
}
export function getChunk(sha,signal){return github('/git/blobs/'+sha,{headers:{Accept:'application/vnd.github.raw+json'},signal})}


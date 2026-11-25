export class GitHubRequestError extends Error {
 constructor(status, stage, requestId, cause) {
  super('GitHub ' + stage + ' HTTP ' + status + (requestId ? ' (request ' + requestId + ')' : ''), {cause});
  this.upstreamStatus = status;
  this.stage = stage;
  this.status = 502;
 }
}

const base=()=>`https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`;
export async function github(path, {allowMissing = false, stage = 'request', ...options} = {}) {
 let response;
 try {
  response = await fetch(base() + path, {
   ...options,
   headers:{
    Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    ...options.headers
   },
   signal:options.signal ?? AbortSignal.timeout(180000)
  });
 } catch (cause) {
  throw new GitHubRequestError(0, stage, null, cause);
 }
 if (!response.ok && !(allowMissing && response.status === 404)) {
  const error = new GitHubRequestError(response.status, stage, response.headers.get('x-github-request-id'));
  await response.body?.cancel().catch(() => {});
  throw error;
 }
 return response;
}
export async function isPrivateVideoRepo() {
 const response = await github('', {stage:'repo'});
 const repository = await response.json();
 return repository.private === true;
}
export async function checkVideoBranch() {
 const branch = process.env.GITHUB_BRANCH || 'main';
 const response = await github('/branches/' + encodeURIComponent(branch), {stage:'branch'});
 await response.body?.cancel();
}

let queue=Promise.resolve();
function queueWrite(operation) {
 const task = queue.then(operation);
 queue = task.catch(() => {});
 return task;
}
export function putChunk(path,bytes){
 return queueWrite(async () => {
  const response = await github('/contents/' + path, {
   method:'PUT',
   stage:'write',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({
    message:'Store ' + path,
    branch:process.env.GITHUB_BRANCH || 'main',
    content:bytes.toString('base64')
   })
  });
  const data = await response.json();
  return {path, sha:data.content.sha, size:bytes.length};
 });
}
export function getChunk(sha,signal){return github('/git/blobs/'+sha,{headers:{Accept:'application/vnd.github.raw+json'},signal})}


export function videoDirectory(userId, videoId) {
 const prefix = (process.env.GITHUB_FOLDER || 'videos').replace(/^\/+|\/+$/g, '');
 if (!validVideoPrefix(prefix)) throw Error('GITHUB_FOLDER không hợp lệ.');
 return prefix + '/' + userId + '/' + videoId;
}

function validVideoPrefix(prefix) {
 return /^[a-zA-Z0-9_/-]+$/.test(prefix) && !prefix.split('/').includes('');
}

export function deleteVideoChunks(userId, videoId, chunks) {
 const branch = process.env.GITHUB_BRANCH || 'main';
 const videoSuffix = '/' + userId + '/' + videoId;
 const directories = new Set([videoDirectory(userId, videoId)]);
 for (const {path} of chunks) {
  if (typeof path !== 'string') continue;
  // Older uploads can use a different GITHUB_FOLDER. Only use paths belonging to this video.
  const directory = path.slice(0, path.lastIndexOf('/'));
  const prefix = directory.slice(0, -videoSuffix.length);
  if (directory.endsWith(videoSuffix) && validVideoPrefix(prefix)) directories.add(directory);
 }
 return queueWrite(async () => {
  await checkVideoBranch();
  for (const directory of directories) {
   const response = await github('/contents/' + directory + '?ref=' + encodeURIComponent(branch), {allowMissing:true});
   if (response.status === 404) {
    await response.body?.cancel();
    continue;
   }
   const entries = await response.json();
   if (!Array.isArray(entries)) throw Error('Thư mục video trên GitHub không hợp lệ.');
   for (const entry of entries) {
    if (entry.type !== 'file' || !/^\d{5}\.part$/.test(entry.name)) continue;
    const part = directory + '/' + entry.name;
    const deleted = await github('/contents/' + part, {
     method:'DELETE',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({message:'Remove video part ' + part, sha:entry.sha, branch})
    });
    await deleted.body?.cancel();
   }
  }
 });
}

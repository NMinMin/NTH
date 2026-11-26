import {EventEmitter, once} from 'node:events';
import {getChunk} from './github.js';

const cacheLimit = 96 * 1024 * 1024;
const parts = new Map();
let cachedBytes = 0;
let activeLoads = 0;
const queued = [];

function loadQueuedParts() {
 while (activeLoads < 4 && queued.length) {
  activeLoads++;
  queued.shift()().finally(() => {
   activeLoads--;
   loadQueuedParts();
  });
 }
}

export function loadVideoPart(sha, size) {
 const key = sha + ':' + size;
 const cached = parts.get(key);
 if (cached) {
  parts.delete(key);
  parts.set(key, cached);
  return cached;
 }

 const part = {
  bytes: null,
  ready: false,
  received: 0,
  updates: new EventEmitter().setMaxListeners(0),
  error: null
 };
 parts.set(key, part);
 queued.push(async () => {
  try {
   part.bytes = Buffer.allocUnsafe(size);
   await fillPart(sha, part);
   part.ready = true;
   cachedBytes += size;
   for (const [oldKey, oldPart] of parts) {
    if (cachedBytes <= cacheLimit) break;
    if (!oldPart.ready) continue;
    parts.delete(oldKey);
    cachedBytes -= oldPart.bytes.length;
   }
  } catch (error) {
   parts.delete(key);
   part.error = error;
   part.updates.emit('progress');
  }
 });
 loadQueuedParts();
 return part;
}

async function fillPart(sha, part) {
 const {body} = await getChunk(sha);
 const reader = body.getReader();
 try {
  while (part.received < part.bytes.length) {
   const {done, value} = await reader.read();
   if (done || value.length > part.bytes.length - part.received) {
    throw Error('Invalid video part size from GitHub');
   }
   part.bytes.set(value, part.received);
   part.received += value.length;
   part.updates.emit('progress');
  }
 } finally {
  await reader.cancel().catch(() => {});
 }
}

export async function writeVideoPart(cached, {from, to}, res, signal) {
 let offset = from;
 while (offset < to) {
  signal.throwIfAborted();
  if (cached.error) throw cached.error;
  const end = Math.min(to, cached.received);
  if (end <= offset) {
   await once(cached.updates, 'progress', {signal});
   continue;
  }
  const accepted = res.write(cached.bytes.subarray(offset, end));
  offset = end;
  if (!accepted) await once(res, 'drain', {signal});
 }
}

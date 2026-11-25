import test from 'node:test';
import assert from 'node:assert/strict';
import {rangeOf,sign,verify} from '../server/media.js';
test('range parsing: full, open, suffix, clipped',()=>{
 assert.deepEqual(rangeOf(null,100),{start:0,end:99,partial:false});
 assert.deepEqual(rangeOf('bytes=10-19',100),{start:10,end:19,partial:true});
 assert.deepEqual(rangeOf('bytes=98-',100),{start:98,end:99,partial:true});
 assert.deepEqual(rangeOf('bytes=-12',100),{start:88,end:99,partial:true});
 assert.deepEqual(rangeOf('bytes=80-200',100),{start:80,end:99,partial:true});
});
test('invalid or multi ranges fail',()=>{for(const r of ['bytes=100-','bytes=3-1','bytes=-0','bytes=-','bytes=0-1,3-4','foo','bytes=999999999999999999-'])assert.throws(()=>rangeOf(r,100))});
test('media signature is bound to video, owner and expiry',()=>{
 const exp=Math.floor(Date.now()/1000)+60,sig=sign('v','u',exp,'secret');
 assert.ok(verify('v','u',exp,sig,'secret'));
 for(const args of [['w','u',exp,sig,'secret'],['v','x',exp,sig,'secret'],['v','u',exp,'bad','secret'],['v','u',exp,sig,'other'],['v','u',1,sign('v','u',1,'secret'),'secret']])assert.equal(verify(...args),false);
});


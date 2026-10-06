const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {JSDOM}=require('jsdom');
const source=readFileSync(require('node:path').join(__dirname,'../bilibili-auto-cancel-play-next.user.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,90));
const collection='BV1QiaS6CEUz', parts='BV1RfHo6yEZY', single='BV1LAth6SEZ9';
function metadata(bvid,count=1,season=false){return {bvid,pages:Array.from({length:count},(_,i)=>({page:i+1,cid:100+i})),...(season?{ugc_season:{id:6020791}}:{})};}
function controls(value='0') {return `<div class="bpx-player-ctrl-setting-handoff-content" style="display:none"><label><input type="radio" name="handoff" value="0" ${value==='0'?'checked':''}><span class="bui-radio-text">自动切集</span></label><label><input type="radio" name="handoff" value="2" ${value==='2'?'checked':''}><span class="bui-radio-text">播完暂停</span></label></div>`;}
function setup({data=metadata(single),p=1,hiddenParent=false,mode='0',withControls=true,fetchImpl}={}){
 const dom=new JSDOM(`<div class="bpx-player-container" ${hiddenParent?'style="display:none"':''}>${withControls?controls(mode):''}<a class="bpx-player-ending-related-item"><div class="bpx-player-ending-related-item-cancel" data-i18n="cancelAutoPlayNext" style="display:none">取消连播</div></a></div>`,{runScripts:'outside-only',url:`https://www.bilibili.com/video/${data?.bvid||single}/?p=${p}`});
 const w=dom.window;w.console.debug=()=>{};w.console.warn=()=>{};
 const observers=[]; const NativeObserver=w.MutationObserver;
 w.MutationObserver=class extends NativeObserver {constructor(fn){super(fn);observers.push(this);}};
 w.__INITIAL_STATE__={videoData:data};
 w.fetch=fetchImpl||(()=>Promise.reject(new Error('offline fixture')));
 const button=w.document.querySelector('[data-i18n]');let clicks=0,modeChanges=0;
 button.addEventListener('click',()=>{clicks++;button.style.display='none';});
 w.document.addEventListener('change',e=>{if(e.target.name==='handoff') modeChanges++;});
 w.eval(source);
 return {dom,button,cleanup(){observers.forEach(o=>o.disconnect());w.close();},get clicks(){return clicks;},get modeChanges(){return modeChanges;},get mode(){return w.document.querySelector('[name="handoff"]:checked')?.value;}};
}
async function using(options,body){const s=setup(options);try{await body(s);}finally{s.cleanup();}}
test('collection uses stop-after-current even when settings menu is hidden',()=>using({data:metadata(collection,1,true)},async s=>{await tick();assert.equal(s.mode,'2');assert.equal(s.modeChanges,1);}));
test('middle P re-enables automatic handoff after a previous collection',()=>using({data:metadata(parts,9),p:2,mode:'2'},async s=>{await tick();assert.equal(s.mode,'0');}));
test('last P stops instead of handing off or looping the list',()=>using({data:metadata(parts,9),p:9},async s=>{await tick();assert.equal(s.mode,'2');s.button.style.display='';await tick();assert.equal(s.clicks,1);}));
test('middle P does not click an ending cancellation',()=>using({data:metadata(parts,9),p:2},async s=>{s.button.style.display='';await tick();assert.equal(s.clicks,0);}));
test('a multipart entry inside a collection continues only within that BV',()=>using({data:metadata(parts,9,true),p:2,mode:'2'},async s=>{await tick();assert.equal(s.mode,'0');s.dom.window.history.replaceState({},'',`/video/${parts}/?p=9`);s.button.style.display='';await tick();assert.equal(s.mode,'2');assert.equal(s.clicks,1);}));
test('SPA collection to middle P and last P updates mode without reloading',()=>using({data:metadata(collection,1,true)},async s=>{await tick();assert.equal(s.mode,'2');const w=s.dom.window;w.__INITIAL_STATE__.videoData=metadata(parts,9);w.history.pushState({},'',`/video/${parts}/?p=2`);w.document.body.classList.add('route-changed');await tick();assert.equal(s.mode,'0');w.history.pushState({},'',`/video/${parts}/?p=9`);w.document.body.classList.remove('route-changed');await tick();assert.equal(s.mode,'2');}));
test('controls inserted after metadata are also handled',()=>using({data:metadata(collection,1,true),withControls:false},async s=>{await tick();s.dom.window.document.querySelector('.bpx-player-container').insertAdjacentHTML('afterbegin',controls());await tick();assert.equal(s.mode,'2');}));
test('already selected mode does not receive repeated change events',()=>using({data:metadata(collection,1,true),mode:'2'},async s=>{await tick();s.button.classList.add('changed');await tick();assert.equal(s.modeChanges,0);assert.equal(s.mode,'2');}));
test('unknown metadata does not disable multipart handoff',()=>using({data:null},async s=>{await tick();assert.equal(s.mode,'0');assert.equal(s.modeChanges,0);}));
test('wrong BV initial state is ignored and current metadata is fetched',()=>using({data:metadata(collection,1,true),fetchImpl:async()=>({ok:true,json:async()=>({code:0,data:metadata(parts,9)})})},async s=>{await tick();assert.equal(s.mode,'2');const w=s.dom.window;w.history.pushState({},'',`/video/${parts}/?p=2`);w.document.body.classList.add('changed');await tick();assert.equal(s.mode,'0');}));
test('API supplies current collection metadata if initial state is absent',()=>using({data:null,fetchImpl:async()=>({ok:true,json:async()=>({code:0,data:metadata(single,1,true)})})},async s=>{await tick();assert.equal(s.mode,'2');}));
test('late API result from previous BV cannot change the new multipart mode',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});
 await using({data:null,fetchImpl:()=>pending},async s=>{const w=s.dom.window;w.__INITIAL_STATE__.videoData=metadata(parts,9);w.history.pushState({},'',`/video/${parts}/?p=2`);w.document.body.classList.add('changed');await tick();resolve({ok:true,json:async()=>({code:0,data:metadata(single,1,true)})});await tick();assert.equal(s.mode,'0');});
});
test('same button can cancel the next countdown after being reused',()=>using({},async s=>{s.button.style.display='';await tick();assert.equal(s.clicks,1);s.button.style.display='';await tick();assert.equal(s.clicks,2);}));
test('hidden player does not consume cancellation before it appears',()=>using({hiddenParent:true},async s=>{s.button.style.display='';await tick();assert.equal(s.clicks,0);s.button.closest('.bpx-player-container').style.display='';await tick();assert.equal(s.clicks,1);}));
test('initially hidden button remains unclicked',()=>using({},async s=>{await tick();assert.equal(s.clicks,0);}));
test('ordinary recommendation is still cancelled without changing playback settings',()=>using({},async s=>{s.button.style.display='';await tick();assert.equal(s.clicks,1);assert.equal(s.modeChanges,0);}));

test('unknown video metadata never consumes a possibly valid multipart countdown',()=>using({data:null},async s=>{s.button.style.display='';await tick();assert.equal(s.clicks,0);}));

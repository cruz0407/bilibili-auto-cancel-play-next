const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const source=fs.readFileSync(process.argv[2]||'bilibili-auto-cancel-play-next.user.js','utf8');
const dom=new JSDOM(`<div class="bpx-player-container"><div class="bpx-player-render-dm-wrap"><span id="dm">弹幕</span></div><div class="bpx-player-ending-wrap" style="display:none"><a class="bpx-player-ending-related-item"><div class="bpx-player-ending-related-item-cancel" data-i18n="cancelAutoPlayNext" style="display:none">取消连播</div><div class="bpx-player-ending-related-item-countdown"><svg><path id="animation"></path></svg></div></a></div><div class="bpx-player-ctrl-setting-handoff-content"><label><input type="radio" name="mode" value="0" checked>自动切集</label><label><input type="radio" name="mode" value="2">播完暂停</label></div></div><div id="comments">${'<div class="comment">评论</div>'.repeat(4000)}</div>`,{runScripts:'outside-only',url:'https://www.bilibili.com/video/BV1LAth6SEZ9/'});
const w=dom.window;
w.__INITIAL_STATE__={videoData:{bvid:'BV1LAth6SEZ9',pages:[{page:1,cid:1}]}};
w.console.debug=()=>{};
const observers=[];const NativeObserver=w.MutationObserver;
w.MutationObserver=class extends NativeObserver{constructor(fn){super(fn);observers.push(this);}};
let fullPageQueries=0,elementQueries=0,styleReads=0;
for(const method of ['querySelector','querySelectorAll']){
 const docQuery=w.Document.prototype[method];
 w.Document.prototype[method]=function(...args){fullPageQueries++;return docQuery.apply(this,args);};
 const elementQuery=w.Element.prototype[method];
 w.Element.prototype[method]=function(...args){elementQueries++;return elementQuery.apply(this,args);};
}
const computed=w.getComputedStyle.bind(w);w.getComputedStyle=(...args)=>{styleReads++;return computed(...args);};
const comments=w.document.getElementById('comments'),dm=w.document.getElementById('dm'),animation=w.document.getElementById('animation');
w.eval(source);
setTimeout(()=>{
 fullPageQueries=elementQueries=styleReads=0;
 let batches=0;
 const churn=setInterval(()=>{
 batches++;comments.style.opacity=batches%2?'0.9':'1';
 dm.style.transform=`translateX(${batches}px)`;
 animation.style.opacity=batches%2?'0.8':'1';
 },15);
 setTimeout(()=>{
 clearInterval(churn);
 console.log(JSON.stringify({source:process.argv[2]||'current',durationMs:1250,mutationBatches:batches,fullPageQueries,elementQueries,styleReads}));
 observers.forEach(o=>o.disconnect());w.close();
 },1250);
},100);

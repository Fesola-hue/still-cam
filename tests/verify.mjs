// Dependency-free real-browser regression checks. Run: node tests/verify.mjs
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "tests", "artifacts");
await fs.mkdir(output, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://local").pathname).replace(/\/$/, "/index.html"));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const data = await fs.readFile(file);
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" })[path.extname(file)] || "text/plain");
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "still-check-"));
const downloads = await fs.mkdtemp(path.join(os.tmpdir(), "still-download-"));
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9333", "--user-data-dir=" + profile, "about:blank"
], { windowsHide: true, stdio: "ignore" });
let ws;
try {
  let tabs;
  for (let i = 0; i < 100; i++) {
    try { tabs = await (await fetch("http://127.0.0.1:9333/json")).json(); if (tabs.length) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert(tabs?.length, "Headless browser started");
  ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const shot = async name => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await fs.writeFile(path.join(output, name + ".png"), Buffer.from(data, "base64"));
  };
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
  for (let i = 0; i < 100; i++) {
    if (await evaluate("typeof renderMemory === 'function' && document.readyState === 'complete'")) break;
    await new Promise(r => setTimeout(r, 50));
  }
  await evaluate("document.querySelector('#appSplash')?.remove()");
  await shot("photos-390");
  const results = await evaluate(`(async () => {
    const checks = [];
    function check(condition, name) { if (!condition) throw Error(name); checks.push(name); }
    function hash(c) {
      const p = c.getContext("2d").getImageData(0,0,c.width,c.height).data;
      let h = 2166136261; for (const byte of p) h = Math.imul(h ^ byte, 16777619);
      return h >>> 0;
    }
    const fixtures = [];
    for (let n = 0; n < 4; n++) {
      const c = surface(900, 1100), cx = c.getContext("2d");
      cx.fillStyle = ["#b4ced0","#d9b3a7","#b2c2a4","#cab8ca"][n]; cx.fillRect(0,0,900,1100);
      cx.fillStyle = "#faf0d3"; cx.beginPath(); cx.arc(670,210,94,0,Math.PI*2); cx.fill();
      cx.fillStyle = ["#587f76","#a06a60","#74805b","#78758e"][n];
      cx.beginPath(); cx.moveTo(0,690); cx.lineTo(320,310); cx.lineTo(700,780); cx.lineTo(900,590); cx.lineTo(900,1100); cx.lineTo(0,1100); cx.fill();
      cx.fillStyle = "#e1d0af"; cx.fillRect(0,900,900,200);
      for (let i=0;i<200;i++) { cx.fillStyle = i%2 ? "#eadac5" : "#9b8371"; cx.fillRect((i*73)%900,930+(i*31)%160,3,3); }
      const blob = await new Promise(resolve => c.toBlob(resolve));
      const file = new File([blob], "memory-" + n + ".png", {type:"image/png"});
      fixtures.push(file);
    }
    await Promise.all(fixtures.map((file,i) => loadPhoto(file,i)));
    check(state.photos.every(Boolean), "Four original uploads decode");
    const neutral = photoWindow(state.photos[0].image,490,435,{...NEUTRAL_EDITS});
    const originalHash = hash(neutral);
    // Measure grain at the size users actually see, not just export pixels.
    const flat = surface(968,968); flat.getContext("2d").fillStyle="#888888"; flat.getContext("2d").fillRect(0,0,968,968);
    const grainSamples = [0,50,100].map(grain=>{
      const photo=photoWindow(flat,968,968,{...NEUTRAL_EDITS,grain});
      const small=surface(120,120); small.getContext("2d").drawImage(photo,0,0,120,120);
      const bytes=small.getContext("2d").getImageData(0,0,120,120).data;
      let energy=0, monochrome=true;
      for(let i=0;i<bytes.length;i+=4){
        monochrome &&= bytes[i]===bytes[i+1] && bytes[i]===bytes[i+2];
        energy+=(bytes[i]-136)**2;
      }
      check(monochrome,"Grain remains monochrome at "+grain);
      return {rms:Math.sqrt(energy/(120*120)),photo};
    });
    check(grainSamples[0].rms===0 && grainSamples[2].rms>3 && grainSamples[2].rms>grainSamples[1].rms*1.6,"Grain remains visibly adjustable at phone-preview size");
    const grainSheet=surface(750,290), gc=grainSheet.getContext("2d");
    gc.fillStyle="#f4f0e8";gc.fillRect(0,0,750,290);gc.fillStyle="#563b39";gc.font="16px Georgia";
    grainSamples.forEach((sample,i)=>{gc.drawImage(sample.photo,i*250+15,15,220,220);gc.fillText("Grain "+[0,50,100][i],i*250+15,265);});
    window.grainComparison=grainSheet.toDataURL("image/png");
    for (const tool of Object.keys(NEUTRAL_EDITS)) {
      const edited = photoWindow(state.photos[0].image,490,435,{...NEUTRAL_EDITS,[tool]:75});
      check(hash(edited)!==originalHash, tool + " changes photo pixels");
    }
    const a = hash(photoWindow(state.photos[0].image,490,435,{...NEUTRAL_EDITS,grain:60,warmth:30}));
    photoWindow(state.photos[0].image,490,435,{...NEUTRAL_EDITS,grain:90,blur:80});
    check(hash(photoWindow(state.photos[0].image,490,435,{...NEUTRAL_EDITS,grain:60,warmth:30}))===a,"Edits deterministic without progressive degradation");
    check(hash(photoWindow(state.photos[0].image,490,435,{...NEUTRAL_EDITS}))===originalHash,"Neutral restores original pixels");
    const sheet = surface(1350, 9*390), sx=sheet.getContext("2d"); sx.fillStyle="#f4f0e8"; sx.fillRect(0,0,sheet.width,sheet.height);
    let row=0;
    for (const [layout,variants] of Object.entries(VARIATIONS)) for (const v of variants) {
      for (const [col,style] of ["classic","scrapbook","messy"].entries()) {
        const c=surface(1,1);
        renderMemory(c,state.photos.slice(0,v.count).map(p=>p.image),{layout,variation:v.id,style,edits:{...NEUTRAL_EDITS},caption:"a small lovely day, kept forever. with all my favourite people, in our favourite place."});
        check(c.width>=760 && c.height>=1100 && hash(c)!==0,layout+"/"+v.id+"/"+style+" renders");
        const scale=Math.min(410/c.width,340/c.height);
        sx.drawImage(c,col*450+(450-c.width*scale)/2,row*390+27,c.width*scale,c.height*scale);
        sx.fillStyle="#563b39"; sx.font="16px Georgia"; sx.fillText(layout+" · "+v.id+" · "+style,col*450+20,row*390+380);
      }
      row++;
    }
    window.testSheet=sheet.toDataURL("image/png");
    const tx=surface(800,300).getContext("2d"); tx.font='30px Georgia';
    for (const text of ["W".repeat(160),"a lovely little memory ".repeat(7),"記憶".repeat(80)]) check(wrapCaption(tx,text,470).every(line=>tx.measureText(line).width<=470),"Caption wraps within width");
    state.layout="stack"; state.variation="pile"; state.style="messy"; state.caption="all my favourite people, in one little place.";
    document.querySelector('[name="layout"][value="stack"]').checked=true;
    document.querySelector('[name="frameStyle"][value="messy"]').checked=true;
    document.querySelector("#caption").value=state.caption;
    customize();
    state.edits.warmth=35; syncTool(); renderPreview();
    document.querySelector("#resetEdits").click();
    check(Object.values(state.edits).every(v=>v===0),"Reset edits clears every tool");
    const neutralPreview = hash(canvas);
    document.querySelector("#editPanel").open = true;
    document.querySelector('[data-tool="contrast"]').click();
    document.querySelector("#editSlider").value = "65";
    document.querySelector("#editSlider").dispatchEvent(new Event("input",{bubbles:true}));
    await new Promise(r=>setTimeout(r,160));
    check(hash(canvas)!==neutralPreview && state.edits.contrast===65,"Toolbar slider updates live Canvas");
    document.querySelector("#resetEdits").click();
    check(hash(canvas)===neutralPreview,"Reset returns exact live preview");
    const before=hash(canvas);
    startDeveloping();
    await new Promise(resolve=>setTimeout(resolve,3400));
    check(!document.querySelector("#resultScreen").hidden,"Developing reaches Result");
    check(hash(canvas)===before,"Developing preserves exact preview pixels");
    const png=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    const bitmap=await createImageBitmap(png), decoded=surface(canvas.width,canvas.height);
    decoded.getContext("2d").drawImage(bitmap,0,0); bitmap.close();
    check(hash(decoded)===before,"Export PNG matches preview pixel for pixel");
    document.querySelector("#editButton").click();
    check(state.layout==="stack" && state.variation==="pile" && state.style==="messy" && state.caption.includes("favourite"),"Edit preserves current work");
    check(hash(canvas)===before,"Edit returns identical composition");
    return checks;
  })()`);
  const sheet = await evaluate("window.testSheet");
  const grainComparison=await evaluate("window.grainComparison");
  await fs.writeFile(path.join(output,"grain-comparison.png"),Buffer.from(grainComparison.split(",")[1],"base64"));
  await fs.writeFile(path.join(output,"composition-matrix.png"),Buffer.from(sheet.split(",")[1],"base64"));
  await shot("customize-390");
  await evaluate('document.querySelector("#editPanel").open = false');
  await shot("customize-simple-390");
  for (const [width,height] of [[375,667],[390,664],[393,852],[430,739],[844,390]]) {
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:true});
    await evaluate('showScreen("customizeScreen")');
    for (const open of [false,true]) {
      await evaluate('document.querySelector("#editPanel").open = '+open);
      assert(await evaluate("document.documentElement.scrollWidth <= "+width),"Phone controls overflow");
      const smallTargets = await evaluate(`[...document.querySelectorAll('#customizeScreen button, #customizeScreen summary, #customizeScreen .selector-options span, #editSlider, #caption')].filter(e=>e.checkVisibility() && e.getBoundingClientRect().height<43.9).map(e=>({id:e.id,text:e.textContent,height:e.getBoundingClientRect().height}))`);
      assert.equal(smallTargets.length,0,"Phone touch targets are 44px: "+JSON.stringify(smallTargets));
      await evaluate('document.querySelector("#developButton").scrollIntoView({block:"end"})');
      assert(await evaluate('document.querySelector("#developButton").getBoundingClientRect().bottom<=innerHeight+1'),"Develop remains reachable");
    }
    await evaluate('document.querySelector("#editPanel").open=false; window.scrollTo(0,0)');
    if(width===375) await shot("customize-small-iphone");
    results.push("Phone layout and touch targets "+width+"x"+height+" with edits open/closed");
  }
  await evaluate('document.querySelector("#editPanel").open=true');
  for (const width of [320,360,390,430]) {
    await send("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:true});
    for (const screen of ["uploadScreen","customizeScreen","resultScreen"]) {
      await evaluate('showScreen("' + screen + '")');
      assert(await evaluate("document.documentElement.scrollWidth <= " + width),screen+" overflows at "+width);
    }
    results.push("No horizontal overflow at "+width+"px across screens");
  }
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  assert(await evaluate(`(async()=>{customize();startDeveloping();await new Promise(r=>setTimeout(r,1000));return !document.querySelector("#resultScreen").hidden;})()`),"Reduced motion completes");
  results.push("Reduced motion completes without print movement");
  await shot("result-390");
  await evaluate('document.querySelector("#saveButton").click()');
  let downloaded;
  for (let i=0;i<100;i++) {
    try { downloaded=await fs.readFile(path.join(downloads,"still-stack-messy.png")); break; } catch {}
    await new Promise(r=>setTimeout(r,50));
  }
  assert(downloaded?.length > 1000,"Save downloads PNG");
  const displayed = await evaluate('canvas.toDataURL("image/png")');
  assert(downloaded.equals(Buffer.from(displayed.split(",")[1],"base64")),"Save downloads exact rendered Canvas");
  await fs.writeFile(path.join(output,"still-stack-messy.png"),downloaded);
  results.push("Save button downloads the exact displayed PNG");
  await evaluate("resetApp()");
  assert(await evaluate('state.photos.every(p=>!p) && state.layout==="single" && state.style==="classic" && state.caption==="" && Object.values(state.edits).every(v=>v===0) && document.querySelector("#continueButton").disabled'),"Try another resets");
  results.push("Try another clears photos, edits, caption and choices");
  // Exercise native file-input events as well as asynchronous decoding.
  const doc = await send("DOM.getDocument");
  const input = await send("DOM.querySelector",{nodeId:doc.root.nodeId,selector:"#photoInput"});
  await send("DOM.setFileInputFiles",{nodeId:input.nodeId,files:[path.join(root,"assets","still-icon-512.png")]});
  for(let i=0;i<50;i++){ if(await evaluate("complete()"))break; await new Promise(r=>setTimeout(r,50)); }
  assert(await evaluate("complete() && state.photos[0].name==='still-icon-512.png'"),"Native upload");
  await evaluate('document.querySelector("#continueButton").click()');
  assert(await evaluate('!document.querySelector("#customizeScreen").hidden'),"Continue flow");
  await evaluate(`document.querySelector("#backButton").click(); document.querySelector('[name="layout"][value="strip"]').click()`);
  await send("DOM.setFileInputFiles",{nodeId:input.nodeId,files:[path.join(root,"assets","still-icon-512.png"),path.join(root,"assets","still-icon-192.png"),path.join(root,"assets","still-icon-180.png")]});
  for(let i=0;i<50;i++){ if(await evaluate("complete()"))break; await new Promise(r=>setTimeout(r,50)); }
  assert(await evaluate("complete() && count()===3"),"Native batch upload");
  await evaluate(`document.querySelector("#continueButton").click(); document.querySelector('[name="customVariations"][value="four"]').click()`);
  assert(await evaluate('document.querySelector("#developButton").disabled && !document.querySelector("#missingPhotos").hidden'),"Missing extra photo is gated");
  results.push("Native single and batch uploads, Continue, and missing-photo gating");
  assert(await evaluate(`(async()=>{await navigator.serviceWorker.ready; const c=await caches.open("still-app-v4");return Boolean(await c.match("./renderer.js"));})()`),"PWA caches renderer");
  results.push("PWA caches the new renderer for offline use");
  assert.equal(errors.length,0,errors.join("\n"));
  await fs.writeFile(path.join(output,"checks.json"),JSON.stringify(results,null,2));
  console.log(results.length+" checks passed. Artifacts: "+output);
} finally {
  ws?.close(); edge.kill(); server.close();
}

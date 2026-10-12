// Right panel: file info, view thumbnails, section previews, AI analysis, screenshot.
// Depends on: state.js, viewport.js, annotations.js

let sampleApi = null, downloadsApi = null;
(async () => {
  [sampleApi, downloadsApi] = await Promise.all([
    window.claude?.use("sample"),
    window.claude?.use("downloads"),
  ]);
})();

function populateInfo(fileName) {
  document.getElementById("file-name").textContent = fileName;
  document.getElementById("file-meta").textContent =
    meshes.length+" maillage"+(meshes.length>1?"s":"")+" · "+Math.round(totalTris).toLocaleString()+" triangles";
  document.getElementById("dims").innerHTML = `
    <div class="dim-cell"><div class="axis">X</div><div class="val">${SIZE.x.toFixed(1)}<small>mm</small></div></div>
    <div class="dim-cell"><div class="axis">Y</div><div class="val">${SIZE.y.toFixed(1)}<small>mm</small></div></div>
    <div class="dim-cell"><div class="axis">Z</div><div class="val">${SIZE.z.toFixed(1)}<small>mm</small></div></div>`;
  document.getElementById("dims-note").textContent =
    "Enveloppe : "+SIZE.x.toFixed(1)+" × "+SIZE.y.toFixed(1)+" × "+SIZE.z.toFixed(1)+" mm";
  document.getElementById("models").innerHTML =
    `<div class="model-tab active"><span title="${esc(fileName)}">${esc(shortName(fileName))}</span>
     <button class="x" title="Fermer">×</button></div>`;
  document.getElementById("models").querySelector(".x").addEventListener("click", closeModel);
}

const VIEWS = [
  {key:"iso",   label:"Iso",   dir:[1,-1,0.8]},
  {key:"top",   label:"Top",   dir:[0,0,1]},
  {key:"front", label:"Front", dir:[0,-1,0]},
  {key:"side",  label:"Right", dir:[1,0,0]},
];
function captureThumb(dir) {
  const r = SIZE.length()/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*0.65;
  camera.position.copy(CENTER).addScaledVector(new THREE.Vector3(...dir).normalize(), r);
  controls.target.copy(CENTER); controls.update(); camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/jpeg", 0.75);
}
function populateThumbnails() {
  if (!meshes.length) return;
  const savedCam    = camera.position.clone(), savedTarget = controls.target.clone();
  const dimWas      = dimGroup?.visible;
  if (dimGroup) dimGroup.visible = false;
  if (grid) grid.visible = false;
  const vg = document.getElementById("view-grid"); vg.innerHTML="";
  VIEWS.forEach(({key,label,dir}) => {
    const url=captureThumb(dir);
    const div=document.createElement("div"); div.className="view-thumb";
    const img=document.createElement("img"); img.src=url; img.alt=label;
    const sp=document.createElement("span"); sp.className="view-lbl"; sp.textContent=label;
    div.append(img,sp); div.addEventListener("click",()=>setView(key)); vg.appendChild(div);
  });
  const sg = document.getElementById("section-grid"); sg.innerHTML="";
  ["x","y","z"].forEach(axis => {
    const prev={axis:clip.axis,pos:clip.pos,flip:clip.flip,clipOn:flags.clip};
    clip.axis=axis; clip.pos=0.5; clip.flip=false; flags.clip=true;
    updateClip(); applyFlags();
    const url=captureThumb([1,-1,0.8]);
    clip.axis=prev.axis; clip.pos=prev.pos; clip.flip=prev.flip; flags.clip=prev.clipOn;
    updateClip(); applyFlags();
    const div=document.createElement("div"); div.className="view-thumb";
    const img=document.createElement("img"); img.src=url; img.alt="Coupe "+axis.toUpperCase();
    const sp=document.createElement("span"); sp.className="view-lbl"; sp.textContent="Coupe "+axis.toUpperCase();
    div.append(img,sp);
    div.addEventListener("click",()=>{
      setView("iso"); clip.axis=axis; clip.pos=0.5; clip.flip=false; flags.clip=true;
      document.getElementById("clip-pos").value="0.5"; updateClip(); applyFlags();
    });
    sg.appendChild(div);
  });
  if (dimGroup) dimGroup.visible = dimWas;
  if (grid) grid.visible = flags.grid;
  camera.position.copy(savedCam); controls.target.copy(savedTarget); controls.update();
}

function closeModel() {
  while (modelRoot.children.length) modelRoot.remove(modelRoot.children[0]);
  meshes=[]; basePosWorld=[]; clearAnnotations();
  document.getElementById("models").innerHTML="";
  document.getElementById("toolbar").hidden=true;
  document.getElementById("clip-panel").hidden=true;
  document.getElementById("panel-content").hidden=true;
  document.getElementById("panel-empty").hidden=false;
  document.getElementById("drop").hidden=false;
  flags.annotate=false; flags.clip=false; applyFlags();
}

// ---- AI Analysis ----
let aiRunning = false;
document.getElementById("ai-btn").addEventListener("click", async () => {
  if (aiRunning || !meshes.length) return;
  if (!sampleApi) { toast("Claude non disponible dans cet environnement.", true); return; }
  aiRunning = true;
  const btn=document.getElementById("ai-btn"), out=document.getElementById("ai-output");
  btn.disabled=true; btn.textContent="Analyse en cours…";
  out.hidden=false; out.innerHTML=`<em style="color:var(--ink-2)">Analyse…</em>`;
  const names  = meshes.map((m,i)=>m.name||("Mesh "+(i+1))).slice(0,20).join(", ");
  const prompt = `Tu es un ingénieur mécanique senior. Analyse cette pièce ou assemblage 3D :
Fichier : ${modelName}
Maillages : ${meshes.length} — Noms : ${names}
Enveloppe : ${SIZE.x.toFixed(1)} × ${SIZE.y.toFixed(1)} × ${SIZE.z.toFixed(1)} mm
Triangles : ${Math.round(totalTris).toLocaleString()}
Fournis une analyse technique concise (max 250 mots) : description, observations structurelles, fabrication, améliorations.
Réponds en français avec **gras** pour les titres de sections.`;
  try {
    let fullText="";
    await sampleApi(prompt, { onText({text}) { fullText=text; out.innerHTML=renderMd(text); out.scrollTop=out.scrollHeight; } });
    out.innerHTML = renderMd(fullText);
  } catch(err) {
    out.innerHTML = `<span style="color:var(--alert)">Erreur : ${esc(String(err.message||err))}</span>`;
  }
  btn.disabled=false; btn.textContent="Analyser avec Claude"; aiRunning=false;
});

// ---- Screenshot ----
async function screenshot() {
  renderer.render(scene, camera);
  const ts   = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  const name = (shortName(modelName)||"model")+"_"+ts+".png";
  if (downloadsApi) {
    await new Promise(res => renderer.domElement.toBlob(async blob => {
      try { await downloadsApi.save({filename:name, data:blob}); } catch{}
      res();
    }, "image/png"));
  } else {
    const a=document.createElement("a"); a.href=renderer.domElement.toDataURL("image/png");
    a.download=name; a.click();
  }
  toast("Screenshot enregistré.");
}

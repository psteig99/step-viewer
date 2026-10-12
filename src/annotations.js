// 3D-anchored annotation pins: ochre dot + CSS2D label.
// Depends on: state.js, viewport.js (renderer, camera, scene, annotRoot, SIZE, flags)

const annotations = []; let annotNextId=1, annotPending=null, downXY=null;
const raycaster   = new THREE.Raycaster();
const popup       = document.getElementById("annot-popup");
const popupInput  = document.getElementById("annot-input");

function clearAnnotations() {
  annotations.forEach(a => { annotRoot.remove(a.dot); annotRoot.remove(a.lbl); });
  annotations.length = 0;
  document.getElementById("annotations-block").hidden = true;
}

function showAnnotPopup(sx, sy, point) {
  annotPending = point;
  popup.style.left = Math.min(sx+14, window.innerWidth-234)+"px";
  popup.style.top  = Math.max(sy-42, 8)+"px";
  popup.hidden = false; popupInput.value = "";
  requestAnimationFrame(() => popupInput.focus());
}
function hideAnnotPopup() { popup.hidden = true; annotPending = null; }

document.getElementById("annot-ok").addEventListener("click", confirmAnnot);
document.getElementById("annot-cancel").addEventListener("click", hideAnnotPopup);
popupInput.addEventListener("keydown", e => {
  if (e.key==="Enter") { e.preventDefault(); confirmAnnot(); }
  if (e.key==="Escape") hideAnnotPopup();
});
document.addEventListener("pointerdown", e => {
  if (!popup.hidden && !popup.contains(e.target)) hideAnnotPopup();
}, {capture:true});

function confirmAnnot() {
  const text = (popupInput.value||"").trim();
  if (!text || !annotPending) { hideAnnotPopup(); return; }
  const num = annotations.length+1;
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(SIZE.length()*0.008, 12, 10),
    new THREE.MeshBasicMaterial({color:0xc08a3e, depthTest:false})
  );
  dot.position.copy(annotPending); dot.renderOrder=12; annotRoot.add(dot);
  const el = document.createElement("div"); el.className="annot-lbl";
  el.innerHTML = `<span class="annot-num">${num}</span><span class="annot-txt">${esc(text)}</span>`;
  const lbl = new CSS2DObject(el); lbl.position.copy(annotPending); annotRoot.add(lbl);
  const id  = annotNextId++;
  annotations.push({id, num, point:annotPending.clone(), text, dot, lbl});
  refreshAnnotPanel(); hideAnnotPopup();
}

function removeAnnotation(id) {
  const i = annotations.findIndex(a => a.id===id); if (i<0) return;
  const [a] = annotations.splice(i,1);
  annotRoot.remove(a.dot); annotRoot.remove(a.lbl);
  annotations.forEach((x,j) => { const n=x.lbl.element.querySelector(".annot-num"); if(n) n.textContent=j+1; });
  refreshAnnotPanel();
}

function refreshAnnotPanel() {
  const block = document.getElementById("annotations-block");
  const ul    = document.getElementById("annot-list");
  block.hidden = annotations.length===0;
  ul.innerHTML = annotations.map((a,i) =>
    `<li class="annot-item"><span class="annot-num">${i+1}</span>
     <span class="annot-item-txt">${esc(a.text)}</span>
     <button class="annot-del" data-id="${a.id}">×</button></li>`).join("");
  ul.querySelectorAll(".annot-del").forEach(b => b.addEventListener("click", () => removeAnnotation(+b.dataset.id)));
}

// Click on 3D canvas to place annotation
renderer.domElement.addEventListener("pointerdown", e => { downXY=[e.clientX,e.clientY]; });
renderer.domElement.addEventListener("pointerup", e => {
  if (!downXY || Math.hypot(e.clientX-downXY[0],e.clientY-downXY[1])>4 || e.button!==0) return;
  if (!flags.annotate || !meshes.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((e.clientX-rect.left)/rect.width)*2-1,
    -((e.clientY-rect.top)/rect.height)*2+1
  ), camera);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length) showAnnotPopup(e.clientX, e.clientY, hits[0].point);
});

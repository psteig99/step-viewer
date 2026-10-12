// Assembly tree: builds a recursive hierarchy from mesh names split on ":",
// renders collapsible groups with checkboxes, color swatches, inline rename, color picker.
// Depends on: state.js, viewport.js (flyToMeshes, flashMeshes, flags, camera, renderer)

function buildTree(meshList) {
  const root = { label:"root", meshes:[], children:{} };
  meshList.forEach(mesh => {
    const segments = (mesh.name||"—").split(":");
    let node = root;
    segments.forEach((seg, si) => {
      if (si === segments.length-1) {
        node.meshes.push(mesh);
      } else {
        if (!node.children[seg]) node.children[seg] = { label:seg, meshes:[], children:{} };
        node = node.children[seg];
      }
    });
  });
  return root;
}

function allMeshesIn(node) {
  const out = [...node.meshes];
  Object.values(node.children).forEach(c => out.push(...allMeshesIn(c)));
  return out;
}

function firstColor(node) {
  if (node.meshes.length) return "#"+node.meshes[0].userData.baseColor.toString(16).padStart(6,"0");
  for (const c of Object.values(node.children)) { const col=firstColor(c); if(col) return col; }
  return null;
}

// ---- Rename helpers ----
function startRename(li, mesh, span) {
  const input = document.createElement("input");
  input.className = "nm-input"; input.value = mesh.name;
  span.replaceWith(input); input.select();
  const eb = li.querySelector(".edit-btn"); if (eb) eb.style.opacity="0";
  const commit = () => { mesh.name = input.value.trim() || mesh.name; attachNm(li, mesh); };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", e => {
    if (e.key==="Enter") { e.preventDefault(); commit(); }
    if (e.key==="Escape") { input.replaceWith(span); if (eb) eb.style.opacity=""; }
  });
}
function attachNm(li, mesh) {
  li.querySelectorAll(".nm,.nm-input,.edit-btn").forEach(el => el.remove());
  const span = document.createElement("span");
  span.className = "nm"; span.title = "Clic = zoomer · Dbl-clic = renommer"; span.textContent = mesh.name;
  li.appendChild(span);
  const editBtn = document.createElement("button");
  editBtn.className = "edit-btn"; editBtn.textContent = "✏"; editBtn.title = "Renommer";
  li.appendChild(editBtn);
  span.addEventListener("click", e => {
    if (e.detail >= 2) return;
    if (flags.annotate) {
      const b = new THREE.Box3().setFromObject(mesh), c = new THREE.Vector3(); b.getCenter(c);
      const rect = renderer.domElement.getBoundingClientRect(), ndc = c.clone().project(camera);
      showAnnotPopup((ndc.x*.5+.5)*rect.width+rect.left, (-ndc.y*.5+.5)*rect.height+rect.top, c);
      return;
    }
    flyToMeshes([mesh]);
  });
  span.addEventListener("dblclick", () => startRename(li, mesh, span));
  editBtn.addEventListener("click", e => { e.stopPropagation(); startRename(li, mesh, span); });
}

// ---- Tree rendering ----
function renderTreeNode(node, parentUl, depth, pathPrefix) {
  Object.entries(node.children).forEach(([label, child]) => {
    const childMeshes = allMeshesIn(child);
    const li  = document.createElement("li"); li.style.listStyle="none";
    li.dataset.names = childMeshes.map(m=>m.name.toLowerCase()).join("|");
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:5px;padding:3px 2px;cursor:pointer;"+
      "padding-left:"+(depth*14+2)+"px;border-radius:4px;user-select:none;";
    hdr.addEventListener("mouseover", () => { hdr.style.background="var(--cyan-s)"; flashMeshes(childMeshes,true); });
    hdr.addEventListener("mouseout",  () => { hdr.style.background=""; flashMeshes(childMeshes,false); });
    const arrow = document.createElement("span");
    arrow.setAttribute("data-arrow","1");
    arrow.textContent="▾"; arrow.style.cssText="font-size:9px;color:var(--ink-2);flex-shrink:0;transition:transform .15s;width:10px;text-align:center;pointer-events:none;";
    const cb = document.createElement("input"); cb.type="checkbox"; cb.checked=true; cb.style.cssText="accent-color:var(--kraft);flex-shrink:0;";
    const col = firstColor(child);
    const sw = document.createElement("span");
    sw.style.cssText="width:8px;height:8px;border-radius:2px;flex-shrink:0;background:"+(col||"transparent")+";opacity:.7;";
    const lbl = document.createElement("span"); lbl.textContent=label;
    lbl.style.cssText="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;";
    const childPath = pathPrefix ? pathPrefix+":"+label : label;
    lbl.title = "Dbl-clic pour zoomer · "+childPath;
    const meta = document.createElement("span");
    meta.textContent=childMeshes.length; meta.style.cssText="font-size:11px;color:var(--ink-2);white-space:nowrap;";
    hdr.append(arrow, cb, sw, lbl, meta);
    const body = document.createElement("ul");
    body.style.cssText="list-style:none;margin:0;padding:0;border-left:1px solid var(--rule);margin-left:"+(depth*14+8)+"px;";
    let open=true;
    hdr.addEventListener("click", e => {
      if (e.target===cb) return;
      if (e.target===lbl && e.detail===2) { flyToMeshes(childMeshes); return; }
      if (e.target===lbl) return;
      open=!open; body.hidden=!open; arrow.style.transform=open?"":"rotate(-90deg)";
    });
    cb.addEventListener("change", e => {
      childMeshes.forEach(m => { m.visible=e.target.checked; });
      body.querySelectorAll("input[type=checkbox]").forEach(x => { x.checked=e.target.checked; });
    });
    renderTreeNode(child, body, 0, childPath);
    li.append(hdr, body);
    parentUl.appendChild(li);
  });
  node.meshes.forEach(mesh => {
    const segments = (mesh.name||"").split(":");
    const leafLabel = segments[segments.length-1];
    appendMeshRow(parentUl, mesh, depth*14, leafLabel !== mesh.name ? leafLabel : null);
  });
}

function populatePartsList() {
  const ul = document.getElementById("parts-list");
  ul.innerHTML = "";
  document.getElementById("parts-count").textContent = "("+meshes.length+")";
  const tree = buildTree(meshes);
  const hasGroups = Object.keys(tree.children).length > 0;

  const searchInput = document.getElementById("parts-search");
  searchInput.value = "";
  searchInput.oninput = () => {
    const q = searchInput.value.trim().toLowerCase();
    ul.querySelectorAll("li.part").forEach(li => {
      const nm  = li.querySelector(".nm,.nm-input");
      const txt = (nm?.textContent||nm?.value||"").toLowerCase();
      const full = (li.dataset.fullName||"").toLowerCase();
      li.hidden = q && !txt.includes(q) && !full.includes(q);
    });
    ul.querySelectorAll("li[data-names]").forEach(li => {
      li.hidden = q && !li.dataset.names.includes(q);
    });
  };

  if (hasGroups) {
    const bar = document.createElement("div"); bar.style.cssText="display:flex;gap:8px;margin-bottom:6px;";
    const btnAll = (label, state) => {
      const b = document.createElement("button");
      b.textContent=label; b.style.cssText="font:12px var(--font);border:1px solid var(--rule);border-radius:4px;padding:2px 8px;background:transparent;cursor:pointer;color:var(--ink-2);";
      b.addEventListener("click", () => {
        ul.querySelectorAll("li > ul").forEach(u => { u.hidden=state; });
        ul.querySelectorAll("[data-arrow]").forEach(a => { a.style.transform=state?"rotate(-90deg)":""; });
      });
      return b;
    };
    bar.append(btnAll("Tout replier",true), btnAll("Tout déplier",false));
    ul.before(bar);
  }

  if (!hasGroups) meshes.forEach(m => appendMeshRow(ul, m, 0, null));
  else renderTreeNode(tree, ul, 0, "");
}

function selectMeshInTree(hitObj) {
  let m = hitObj;
  while (m && !meshes.includes(m)) m = m.parent;
  if (!m) return;
  const idx = meshes.indexOf(m);
  const li = document.querySelector(`li.part[data-mesh-index="${idx}"]`);
  if (!li) return;
  // Expand any collapsed ancestor <ul> groups
  let el = li.parentElement;
  while (el) {
    if (el.id === "parts-list") break;
    if (el.tagName === "UL" && el.hidden) {
      el.hidden = false;
      const hdr = el.previousElementSibling;
      if (hdr) {
        const arrow = hdr.querySelector("[data-arrow]");
        if (arrow) arrow.style.transform = "";
      }
    }
    el = el.parentElement;
  }
  // Scroll main panel so the Maillages section is visible
  const panel = document.getElementById("panel");
  const sec = document.getElementById("parts-list").closest(".block");
  if (sec && panel) panel.scrollTop = sec.offsetTop - 8;
  // Scroll within the parts list
  setTimeout(() => li.scrollIntoView({behavior:"smooth", block:"nearest"}), 80);
  // Flash animation
  li.classList.remove("tree-sel");
  void li.offsetWidth;
  li.classList.add("tree-sel");
  li.addEventListener("animationend", () => li.classList.remove("tree-sel"), {once:true});
  // Name feedback
  toast((m.name||"").split(":").pop() || ("Mesh "+(idx+1)));
}

function appendMeshRow(parent, mesh, paddingLeft, leafLabel) {
  const col = "#"+mesh.userData.baseColor.toString(16).padStart(6,"0");
  const li  = document.createElement("li"); li.className="part";
  li.style.cssText="padding-left:"+(paddingLeft+4)+"px;grid-template-columns:auto 10px 1fr auto;";
  li.dataset.fullName = mesh.name.toLowerCase();
  li.dataset.meshIndex = meshes.indexOf(mesh).toString();
  li.innerHTML = `<input type="checkbox" checked><span class="sw" style="background:${col};cursor:pointer;border:1px solid transparent;" title="Changer la couleur"></span>`;
  li.querySelector("input").addEventListener("change", e => { mesh.visible=e.target.checked; });
  li.addEventListener("mouseenter", () => { if (mesh.material?.emissive) mesh.material.emissive.setHex(0x223344); });
  li.addEventListener("mouseleave", () => { if (mesh.material?.emissive) mesh.material.emissive.setHex(0); });
  li.querySelector(".sw").addEventListener("click", e => {
    e.stopPropagation();
    const picker = document.createElement("input"); picker.type="color";
    picker.value = "#"+mesh.userData.baseColor.toString(16).padStart(6,"0");
    picker.style.cssText="position:fixed;opacity:0;width:0;height:0;";
    document.body.appendChild(picker);
    picker.addEventListener("input", () => {
      const hex = parseInt(picker.value.slice(1),16);
      mesh.userData.baseColor = hex;
      if (mesh.material?.color) mesh.material.color.setHex(hex);
      e.target.style.background = picker.value;
    });
    picker.addEventListener("change", () => picker.remove());
    picker.click();
  });
  if (leafLabel && leafLabel !== mesh.name) {
    const nm = document.createElement("span"); nm.className="nm";
    nm.textContent=leafLabel; nm.title="Clic = zoomer · Dbl-clic = renommer · ("+mesh.name+")";
    nm.addEventListener("click", e => {
      if (e.detail >= 2) return;
      if (flags.annotate) {
        const b2=new THREE.Box3().setFromObject(mesh), c2=new THREE.Vector3(); b2.getCenter(c2);
        const rect=renderer.domElement.getBoundingClientRect(), ndc=c2.clone().project(camera);
        showAnnotPopup((ndc.x*.5+.5)*rect.width+rect.left, (-ndc.y*.5+.5)*rect.height+rect.top, c2);
      } else { flyToMeshes([mesh]); }
    });
    const doRename = () => {
      const inp=document.createElement("input"); inp.className="nm-input"; inp.value=mesh.name;
      nm.replaceWith(inp); inp.select();
      const commit=()=>{ mesh.name=inp.value.trim()||mesh.name; nm.textContent=mesh.name.split(":").pop(); nm.title=mesh.name; li.dataset.fullName=mesh.name.toLowerCase(); inp.replaceWith(nm); };
      inp.addEventListener("blur",commit);
      inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){e.preventDefault();commit();} if(e.key==="Escape") inp.replaceWith(nm); });
    };
    nm.addEventListener("dblclick", doRename);
    li.appendChild(nm);
    const editBtn=document.createElement("button"); editBtn.className="edit-btn"; editBtn.textContent="✏"; editBtn.title="Renommer";
    editBtn.addEventListener("click", e=>{ e.stopPropagation(); doRename(); });
    li.appendChild(editBtn);
  } else {
    attachNm(li, mesh);
  }
  parent.appendChild(li);
}

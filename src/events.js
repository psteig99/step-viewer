// Toolbar buttons, keyboard shortcuts, file drop/input, utilities.
// Depends on: state.js, viewport.js, panel.js

// ---- Toolbar ----
function toggle(flag) { flags[flag]=!flags[flag]; if(flag==="clip"&&flags.clip) updateClip(); applyFlags(); }

document.getElementById("toolbar").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.view)          setView(b.dataset.view);
  if (b.dataset.action==="fit")  fitView();
  if (b.dataset.action==="shot") screenshot();
  if (b.dataset.toggle)        toggle(b.dataset.toggle);
});
document.getElementById("clip-pos").addEventListener("input",  e => { clip.pos=+e.target.value; updateClip(); });
document.getElementById("clip-flip").addEventListener("click", () => { clip.flip=!clip.flip; updateClip(); });
document.querySelectorAll("[data-axis]").forEach(b => b.addEventListener("click", () => {
  clip.axis = b.dataset.axis;
  document.querySelectorAll("[data-axis]").forEach(x => x.setAttribute("aria-pressed", String(x===b)));
  updateClip();
}));

// ---- Keyboard ----
document.addEventListener("keydown", e => {
  if (e.target.matches("input,select,textarea") || !meshes.length) return;
  ({
    i:()=>setView("iso"), x:()=>setView("top"), y:()=>setView("front"), z:()=>setView("side"),
    r:fitView,
    t:()=>toggle("alpha"), b:()=>toggle("dims"),
    n:()=>toggle("annotate"), p:()=>toggle("clip"), f:screenshot,
    escape:()=>{ if(flags.annotate)toggle("annotate"); else if(flags.clip)toggle("clip"); hideAnnotPopup(); },
  }[e.key.toLowerCase()]||(() => {}))();
});

// ---- File drop ----
const dropEl   = document.getElementById("drop");
const fileInput = document.getElementById("file-input");
dropEl.addEventListener("dragover",  e => { e.preventDefault(); dropEl.classList.add("over"); });
dropEl.addEventListener("dragleave", () => dropEl.classList.remove("over"));
dropEl.addEventListener("drop", e => { e.preventDefault(); dropEl.classList.remove("over"); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => { e.preventDefault(); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
document.getElementById("btn-open").addEventListener("click",   () => fileInput.click());
document.getElementById("btn-browse").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if(fileInput.files[0]) { loadFile(fileInput.files[0]); fileInput.value=""; } });

// ---- Utilities ----
let toastTimer;
function toast(msg, error=false) {
  const el=document.getElementById("toast");
  el.textContent=msg; el.className="toast"+(error?" error":""); el.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{el.hidden=true;}, error?7000:3500);
}
function hint(text) { const el=document.getElementById("hint"); el.hidden=!text; el.textContent=text||""; }
function esc(s)      { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function shortName(n){ return n ? n.replace(/\.[^.]+$/,"").slice(0,40) : ""; }
function renderMd(md){ return esc(md).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\n{2,}/g,"<br><br>").replace(/\n/g,"<br>"); }

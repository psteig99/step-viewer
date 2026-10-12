// Shared application state — imported by all other modules via concatenation.
// In a native ES-module build, export these and import them where needed.

const PALETTE = [0x3b6fb6,0x6aa84f,0xd1495b,0xec8f2a,0x6d7a8a,0x9b59b6,0x1abc9c,0xe67e22,0x2c3e50,0xc0392b,0x8e44ad,0x16a085];

const flags = { dims:true, wire:false, alpha:false, grid:false, annotate:false, clip:false };
const clip  = { axis:"x", pos:0.5, flip:false, plane:new THREE.Plane(new THREE.Vector3(-1,0,0), 0) };

const BOX    = new THREE.Box3();
const CENTER = new THREE.Vector3();
const SIZE   = new THREE.Vector3();

let meshes = [], basePosWorld = [], modelName = "", totalTris = 0;
let grid = null, dimGroup = null;

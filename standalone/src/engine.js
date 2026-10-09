// Moteur d'analyse côté navigateur : dimensions, volumes, masse, colisage.
export const MATERIALS = {
  pet: 1.38, rpet: 1.38, hdpe: 0.95, ldpe: 0.92, pp: 0.90, ps: 1.05, pla: 1.24, pvc: 1.40, verre: 2.50,
  aluminium: 2.70, acier: 7.85, fer_blanc: 7.85, carton: 0.70, carton_ondule: 0.15, papier: 0.80, bois: 0.60,
  liege: 0.24, mousse_pe: 0.03, mousse_pu: 0.04,
};
export const PALLETS = { euro: [1200, 800], iso: [1200, 1000], us: [1219, 1016], demi_euro: [800, 600] };

const r2 = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

/** Analyse d'un maillage indexé (positions Float32Array, index Uint32Array). */
export function analysePart(name, pos, idx) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { if (pos[i + k] < min[k]) min[k] = pos[i + k]; if (pos[i + k] > max[k]) max[k] = pos[i + k]; }
  let vol = 0, area = 0;
  const edges = new Map();
  const addEdge = (a, b) => { const k = a < b ? a * 4294967296 + b : b * 4294967296 + a; edges.set(k, (edges.get(k) || 0) + 1); };
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    // volume signé du tétraèdre (origine, a, b, c)
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    addEdge(a, b); addEdge(b, c); addEdge(c, a);
  }
  // Fermé si chaque arête est partagée par exactement deux triangles (après soudure des sommets).
  let open = 0; edges.forEach((n) => { if (n !== 2) open++; });
  const watertight = open === 0;
  const volAbs = Math.abs(vol);
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  let thick = null;
  if (watertight && area > 0) { const t = (2 * volAbs) / area; if (t <= 0.2 * Math.min(...ext)) thick = r2(t); }
  return {
    nom: name, triangles: idx.length / 3, min, max,
    dimensions_mm: ext.map((x) => r2(x)), centre_mm: ext.map((e, k) => r2(min[k] + e / 2)),
    volume_cm3: watertight ? r2(volAbs / 1000) : null, surface_cm2: r2(area / 100), etanche: watertight,
    epaisseur_mm_estimee: thick, aretes_ouvertes: open,
  };
}

/** Soude les sommets identiques pour que le test de fermeture soit fiable. */
export function weldVertices(pos, idx, tol = 1e-4) {
  const map = new Map(), remap = new Uint32Array(pos.length / 3), out = [];
  const q = 1 / tol;
  for (let i = 0; i < pos.length / 3; i++) {
    const key = `${Math.round(pos[i * 3] * q)}_${Math.round(pos[i * 3 + 1] * q)}_${Math.round(pos[i * 3 + 2] * q)}`;
    let j = map.get(key);
    if (j === undefined) { j = out.length / 3; map.set(key, j); out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    remap[i] = j;
  }
  const nidx = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) nidx[i] = remap[idx[i]];
  return { pos: new Float32Array(out), idx: nidx };
}

export function analyseModel(fileName, parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vol = 0, area = 0, tris = 0;
  const warnings = [];
  for (const p of parts) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.min[k]); max[k] = Math.max(max[k], p.max[k]); }
    if (p.volume_cm3 != null) vol += p.volume_cm3; else warnings.push(`Pièce « ${p.nom} » : maillage non fermé, volume et masse non calculables.`);
    area += p.surface_cm2; tris += p.triangles;
  }
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const bboxVol = (ext[0] * ext[1] * ext[2]) / 1000;
  if (Math.max(...ext) > 3000) warnings.push("Dimensions > 3 m : vérifier l'unité du STEP (pouces ? mètres ?).");
  if (Math.max(...ext) < 1) warnings.push("Dimensions < 1 mm : vérifier l'unité du STEP.");
  const overlaps = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j];
    if (a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1] && a.min[2] < b.max[2] && b.min[2] < a.max[2]) overlaps.push([a.nom, b.nom]);
    if (overlaps.length >= 50) break;
  }
  return {
    fichier: fileName, pieces: parts.length, triangles: tris, min, max,
    dimensions_mm: ext.map((x) => r2(x)), centre_mm: ext.map((e, k) => r2(min[k] + e / 2)),
    volume_englobant_cm3: r2(bboxVol), volume_matiere_cm3: r2(vol), surface_cm2: r2(area),
    taux_remplissage_pct: r2(bboxVol ? (100 * vol) / bboxVol : 0, 1), avertissements: warnings, details: parts, overlaps,
  };
}

/* ---- colisage ------------------------------------------------------------ */
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

export function fitInContainer(unit, container, clearance = 0, allowRotation = true) {
  const u0 = unit.map((x) => x + clearance), c = container;
  if (u0.some((x) => x <= 0) || c.some((x) => x <= 0)) throw new Error("Dimensions invalides");
  let best = null;
  for (const perm of allowRotation ? PERMS : [PERMS[0]]) {
    const u = perm.map((k) => u0[k]);
    const counts = u.map((x, k) => Math.floor(c[k] / x));
    const qty = counts[0] * counts[1] * counts[2];
    if (!best || qty > best.qty) best = { qty, u, counts };
  }
  const used = best.qty * best.u[0] * best.u[1] * best.u[2];
  return {
    quantite: best.qty, par_axe: best.counts, orientation_mm: best.u.map((x) => r2(x - clearance)),
    taux_occupation_pct: r2((100 * used) / (c[0] * c[1] * c[2]), 1), espace_perdu_mm: c.map((x, k) => r2(x - best.counts[k] * best.u[k])),
  };
}

export function fitOnPallet(carton, pallet = "euro", maxHeight = 1800, palletHeight = 144) {
  const [L, l] = PALLETS[pallet] || PALLETS.euro;
  return fitInContainer(carton, [L, l, maxHeight - palletHeight]);
}

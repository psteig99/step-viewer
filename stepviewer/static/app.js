/**
 * app.js — Entry point. Imports the four independent modules.
 *
 * To integrate into your own platform, import only what you need:
 *   import { onModelLoad, captureAll } from "./viewer.js";
 *   import { runAiAnalysis } from "./analysis.js";  // optional
 *   import { exportViews }   from "./export.js";    // optional
 */
import "./viewer.js";   // 3D engine + window.StepViewer API
import "./capture.js";  // auto-generates thumbnails on load
import "./analysis.js"; // "Analyze with AI" button → /api/models/{id}/ai-analysis
import "./export.js";   // "Export views (ZIP)" button

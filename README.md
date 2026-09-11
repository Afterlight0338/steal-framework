# STEAL // FRAMEWORK

> **osu! Beatmap Forensics, Plagiarism & Pattern Cross-Referencing Engine**  
> Live web experience: **[steal.vivlos.dev](https://steal.vivlos.dev)**

`steal-framework` is an automated plagiarism detection engine and forensic cross-referencing suite for osu! beatmaps. When provided with an osu! beatmap link, ID, or a local `.osu` / `.osz` file, it searches for existing beatmaps of the same song across the web via [mirror.hinamizawa.ai](https://mirror.hinamizawa.ai) and performs multi-layer spatial, rhythmic, and geometric analysis to detect stolen, copied, or rotated patterns.

---

## ⚡ Key Features

1. **Flexible Input Handling**:
   - Accepts standard osu! links (`https://osu.ppy.sh/beatmapsets/...#osu/...`, `/b/...`, `/s/...`), Hinamizawa mirror links, or raw IDs.
   - Accepts drag-and-drop local `.osu` difficulty files.
   - In-browser extraction of `.osz` archives with multi-difficulty selection.
2. **Powered by [mirror.hinamizawa.ai](https://mirror.hinamizawa.ai)**:
   - Full integration with the free, CORS-enabled Hinamizawa osu! data API (`llms.txt`).
   - Automated song discovery, metadata resolution, and raw `.osu` fetching.
3. **Multi-Layer Plagiarism Detection**:
   - **Rhythm / Temporal Alignment**: Time-interval pulse matching within configurable tolerance windows ($\le 12\text{ms}$).
   - **Spatial & Coordinate Overlap**: Identifies copied $(X, Y)$ object placements across playfields.
   - **Transformation Invariance**: Automatically tests for common pattern obscuring techniques:
     - Horizontal flip ($X' = 512 - X$)
     - Vertical flip ($Y' = 384 - Y$)
     - 180° rotation
     - 90° and 270° rotations
     - Translation vector shifts ($\Delta X, \Delta Y$)
   - **Slider Geometry Fingerprinting**: Control point curvature, repeat counts, and pixel length matching.
   - **Contiguous Pattern Streak Mining**: Isolates continuous stolen object sequences (combos) and outputs exact timestamps.
   - **Weighted Forensic Verdict**: Categorizes results into `CLEAN`, `SLIGHT_SIMILARITY` (natural song rhythm overlap), `SUSPICIOUS`, and `BLATANT_PLAGIARISM`.
4. **Interactive Playfield Visualizer**:
   - Built-in canvas playfield overlay (Target map in Cyan, Candidate in Crimson, Overlap in Emerald).
   - Scrubber timeline with play/pause and variable speed playback (0.5x, 1x, 2x).
   - Click-to-seek flagged pattern segments.

---

## 🚀 Getting Started

### Local Development

```bash
# Clone repository
git clone https://github.com/Afterlight0338/steal-framework.git
cd steal-framework

# Install dependencies
npm install

# Start local development server
npm run dev
```

### Production Build

```bash
npm run build
npm run preview
```

---

## 🌐 Deployment to `steal.vivlos.dev`

This project is configured with automated GitHub Pages deployment:
- **`public/CNAME`** is set to `steal.vivlos.dev`.
- **`.github/workflows/deploy.yml`** triggers on pushes to `main` and automatically deploys the built static application to GitHub Pages.
- **DNS setup**: In your DNS provider (Cloudflare for `vivlos.dev`), add a CNAME record:
  - **Name**: `steal`
  - **Target**: `afterlight0338.github.io`

---

## 📜 Programmatic Library Usage

`steal-framework` can also be imported directly in Node or browser projects:

```typescript
import { parseOsuFile, compareBeatmaps, searchMirror, fetchRawOsu } from 'steal-framework';

// Parse target beatmap
const targetRaw = await fetchRawOsu(3397214);
const target = parseOsuFile(targetRaw);

// Search for candidate maps of the same song
const candidates = await searchMirror(`${target.metadata.artist} ${target.metadata.title}`);

// Fetch and compare candidate
const candidateRaw = await fetchRawOsu(candidates[0].ChildrenBeatmaps[0].BeatmapID);
const candidate = parseOsuFile(candidateRaw);

const report = compareBeatmaps(target, candidate);
console.log(`Suspicion Score: ${report.overallSuspicionScore}% (${report.verdict})`);
console.log(`Flagged Segments: ${report.segments.length}`);
```

---

## ⚖️ License

MIT License © Afterlight
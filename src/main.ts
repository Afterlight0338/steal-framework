import './style.css';
import { StealEngine } from './core/engine';
import { PlayfieldRenderer } from './core/renderer';
import { extractOsz, ExtractedOsz } from './core/archive';
import { ParsedBeatmap, ComparisonResult, AnalysisProgress } from './core/types';
import { formatTime } from './core/detector';
import { getCoverUrl, getPreviewAudioUrl } from './api/hinamizawa';

// DOM Elements
const mapInput = document.getElementById('map-input') as HTMLInputElement;
const btnAnalyze = document.getElementById('btn-analyze') as HTMLButtonElement;
const dropzone = document.getElementById('dropzone') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;

const progressCard = document.getElementById('progress-card') as HTMLElement;
const progressMsg = document.getElementById('progress-msg') as HTMLElement;
const progressPct = document.getElementById('progress-pct') as HTMLElement;
const progressBarFill = document.getElementById('progress-bar-fill') as HTMLElement;

const resultsSection = document.getElementById('results-section') as HTMLElement;
const targetCover = document.getElementById('target-cover') as HTMLImageElement;
const targetTitle = document.getElementById('target-title') as HTMLElement;
const targetArtist = document.getElementById('target-artist') as HTMLElement;
const statDiff = document.getElementById('stat-diff') as HTMLElement;
const statBpm = document.getElementById('stat-bpm') as HTMLElement;
const statCs = document.getElementById('stat-cs') as HTMLElement;
const statAr = document.getElementById('stat-ar') as HTMLElement;
const statObjs = document.getElementById('stat-objs') as HTMLElement;
const statLen = document.getElementById('stat-len') as HTMLElement;
const audioPreview = document.getElementById('audio-preview') as HTMLAudioElement;

const overallVerdictPill = document.getElementById('overall-verdict-pill') as HTMLElement;
const candidateList = document.getElementById('candidate-list') as HTMLElement;

// Inspector Modal Elements
const inspectorModal = document.getElementById('inspector-modal') as HTMLElement;
const btnCloseModal = document.getElementById('btn-close-modal') as HTMLButtonElement;
const modalTitle = document.getElementById('modal-title') as HTMLElement;
const playfieldCanvas = document.getElementById('playfield-canvas') as HTMLCanvasElement;
const timelineSlider = document.getElementById('timeline-slider') as HTMLInputElement;
const timeDisplay = document.getElementById('time-display') as HTMLElement;
const btnPlayToggle = document.getElementById('btn-play-toggle') as HTMLButtonElement;
const btnSpeed05 = document.getElementById('btn-speed-05') as HTMLButtonElement;
const btnSpeed10 = document.getElementById('btn-speed-10') as HTMLButtonElement;
const btnSpeed20 = document.getElementById('btn-speed-20') as HTMLButtonElement;
const segmentsContainer = document.getElementById('segments-container') as HTMLElement;

// OSZ Diff Picker Elements
const oszModal = document.getElementById('osz-modal') as HTMLElement;
const btnCloseOszModal = document.getElementById('btn-close-osz-modal') as HTMLButtonElement;
const oszDiffList = document.getElementById('osz-diff-list') as HTMLElement;

let renderer: PlayfieldRenderer | null = null;
let currentTargetBeatmap: ParsedBeatmap | null = null;
let activeOszData: ExtractedOsz | null = null;

// Initialize Playfield Renderer
function getOrCreateRenderer(): PlayfieldRenderer {
  if (!renderer) {
    renderer = new PlayfieldRenderer(playfieldCanvas);
    renderer.setOnTimeUpdate((time) => {
      timeDisplay.textContent = formatTime(time);
      const dur = renderer?.getDuration() || 1;
      timelineSlider.value = Math.min(1000, Math.round((time / dur) * 1000)).toString();
    });

    window.addEventListener('resize', () => {
      renderer?.handleResize();
    });
  }
  return renderer;
}

// Setup StealEngine with progress updates
const engine = new StealEngine((p: AnalysisProgress) => {
  progressCard.style.display = 'block';
  progressMsg.textContent = p.message;
  progressPct.textContent = `${p.percent}%`;
  progressBarFill.style.width = `${p.percent}%`;

  if (p.step === 'complete') {
    setTimeout(() => {
      progressCard.style.display = 'none';
    }, 1200);
  }
});

// Run analysis from string link/ID
async function analyzeString(inputStr: string) {
  if (!inputStr.trim()) return;

  btnAnalyze.disabled = true;
  btnAnalyze.textContent = 'Analyzing...';
  resultsSection.style.display = 'none';

  try {
    const analysis = await engine.analyzeTarget({ urlOrId: inputStr });
    currentTargetBeatmap = analysis.targetBeatmap;
    displayResults(analysis.targetBeatmap, analysis.targetSetId, analysis.results);
  } catch (err: any) {
    alert(`Analysis failed: ${err.message || err}`);
    progressCard.style.display = 'none';
  } finally {
    btnAnalyze.disabled = false;
    btnAnalyze.innerHTML = '<span>Run Forensics</span>';
  }
}

// Run analysis from File
async function handleFile(file: File) {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith('.osz') || fileName.endsWith('.zip')) {
    try {
      progressCard.style.display = 'block';
      progressMsg.textContent = 'Extracting beatmapset archive...';
      progressBarFill.style.width = '20%';

      activeOszData = await extractOsz(file);
      progressCard.style.display = 'none';

      if (activeOszData.difficulties.length === 1) {
        // Only one difficulty, analyze immediately
        runAnalysisWithDiff(activeOszData.difficulties[0].parsed);
      } else {
        // Open difficulty selector modal
        showOszDiffPicker(activeOszData);
      }
    } catch (err: any) {
      alert(`Could not extract .osz: ${err.message}`);
      progressCard.style.display = 'none';
    }
  } else if (fileName.endsWith('.osu')) {
    btnAnalyze.disabled = true;
    resultsSection.style.display = 'none';
    try {
      const analysis = await engine.analyzeTarget({ file });
      currentTargetBeatmap = analysis.targetBeatmap;
      displayResults(analysis.targetBeatmap, analysis.targetSetId, analysis.results);
    } catch (err: any) {
      alert(`Analysis failed: ${err.message || err}`);
      progressCard.style.display = 'none';
    } finally {
      btnAnalyze.disabled = false;
    }
  } else {
    alert('Please upload a valid .osu or .osz file.');
  }
}

function showOszDiffPicker(osz: ExtractedOsz) {
  oszDiffList.innerHTML = '';
  osz.difficulties.forEach((d) => {
    const btn = document.createElement('button');
    btn.className = 'btn-ctrl';
    btn.style.textAlign = 'left';
    btn.style.padding = '12px 16px';
    btn.innerHTML = `
      <div style="font-weight: 700; font-size: 15px; color: var(--color-cyan);">${escapeHtml(d.version)}</div>
      <div style="font-size: 12px; color: var(--color-text-muted); margin-top: 4px;">
        CS ${d.cs} • AR ${d.ar} • OD ${d.od} • ${d.objectCount} objects
      </div>
    `;
    btn.onclick = () => {
      oszModal.style.display = 'none';
      runAnalysisWithDiff(d.parsed);
    };
    oszDiffList.appendChild(btn);
  });
  oszModal.style.display = 'flex';
}

async function runAnalysisWithDiff(parsedDiff: ParsedBeatmap) {
  btnAnalyze.disabled = true;
  resultsSection.style.display = 'none';

  try {
    const analysis = await engine.analyzeTarget({
      selectedDiffFromOsz: {
        filename: '',
        version: parsedDiff.metadata.version,
        cs: parsedDiff.difficulty.cs,
        ar: parsedDiff.difficulty.ar,
        od: parsedDiff.difficulty.od,
        hp: parsedDiff.difficulty.hp,
        objectCount: parsedDiff.hitObjects.length,
        parsed: parsedDiff,
      },
    });

    currentTargetBeatmap = analysis.targetBeatmap;
    displayResults(analysis.targetBeatmap, analysis.targetSetId, analysis.results);
  } catch (err: any) {
    alert(`Analysis failed: ${err.message || err}`);
    progressCard.style.display = 'none';
  } finally {
    btnAnalyze.disabled = false;
  }
}

// Display analysis results
function displayResults(target: ParsedBeatmap, setId: number, results: ComparisonResult[]) {
  resultsSection.style.display = 'grid';

  // Target card
  targetCover.src = setId ? getCoverUrl(setId) : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>';
  targetTitle.textContent = target.metadata.title;
  targetArtist.textContent = `${target.metadata.artist} • mapped by ${target.metadata.creator}`;

  statDiff.textContent = target.metadata.version || 'Normal';
  statBpm.textContent = `${target.bpm}`;
  statCs.textContent = `${target.difficulty.cs}`;
  statAr.textContent = `${target.difficulty.ar}`;
  statObjs.textContent = `${target.hitObjects.length}`;
  statLen.textContent = formatTime(target.durationMs);

  if (setId) {
    audioPreview.src = getPreviewAudioUrl(setId);
    audioPreview.style.display = 'block';
  } else {
    audioPreview.style.display = 'none';
  }

  // Summary verdict calculation
  const highestSuspicion = results.length > 0 ? results[0].overallSuspicionScore : 0;
  overallVerdictPill.className = 'verdict-pill';

  if (highestSuspicion >= 75) {
    overallVerdictPill.classList.add('verdict-blatant');
    overallVerdictPill.textContent = `🚨 ${highestSuspicion}% HIGH PLAGIARISM RISK`;
  } else if (highestSuspicion >= 45) {
    overallVerdictPill.classList.add('verdict-suspicious');
    overallVerdictPill.textContent = `⚠️ ${highestSuspicion}% SUSPICIOUS OVERLAP`;
  } else if (highestSuspicion >= 25) {
    overallVerdictPill.classList.add('verdict-slight');
    overallVerdictPill.textContent = `ℹ️ ${highestSuspicion}% SLIGHT SIMILARITY`;
  } else {
    overallVerdictPill.classList.add('verdict-clean');
    overallVerdictPill.textContent = `✓ CLEAN - NO PLAGIARISM`;
  }

  // Candidate cards
  candidateList.innerHTML = '';

  if (results.length === 0) {
    candidateList.innerHTML = `
      <div style="padding: 32px; text-align: center; color: var(--color-text-muted); background: var(--bg-card); border-radius: 14px; border: 1px solid var(--border-subtle);">
        <p style="font-size: 16px;">No other maps for this song found on the mirror.</p>
        <p style="font-size: 13px; margin-top: 6px;">The map appears to be unique or the song has not been mapped elsewhere.</p>
      </div>
    `;
    return;
  }

  results.forEach((res) => {
    const card = document.createElement('div');
    card.className = `candidate-card ${res.overallSuspicionScore >= 50 ? 'flagged' : ''}`;

    let scoreColor = '#34d399';
    if (res.overallSuspicionScore >= 75) scoreColor = '#fb7185';
    else if (res.overallSuspicionScore >= 45) scoreColor = '#fbbf24';
    else if (res.overallSuspicionScore >= 25) scoreColor = '#38bdf8';

    card.innerHTML = `
      <img class="candidate-thumb" src="${res.candidateCoverUrl || ''}" alt="Cover" onerror="this.style.opacity='0.2'">
      <div class="candidate-info">
        <h4>${escapeHtml(res.candidateTitle)} [${escapeHtml(res.candidateVersion)}]</h4>
        <p class="candidate-mapper">Mapped by <strong>${escapeHtml(res.candidateCreator)}</strong></p>
        <div class="candidate-metrics">
          <div class="metric-tag">Rhythm Match: <b>${res.rhythmOverlapPercentage}%</b></div>
          <div class="metric-tag">Spatial Coords: <b>${res.spatialOverlapPercentage}%</b></div>
          <div class="metric-tag">Slider Shapes: <b>${res.sliderGeometryOverlapPercentage}%</b></div>
          ${res.longestStreak >= 6 ? `<div class="metric-tag" style="border-color: rgba(244,63,94,0.4); color: #fb7185;">Copied Streak: <b>${res.longestStreak} objects</b></div>` : ''}
        </div>
      </div>
      <div class="candidate-action">
        <div class="suspicion-score-badge" style="color: ${scoreColor};">
          ${res.overallSuspicionScore}%
        </div>
        <button class="btn-inspect">Inspect Forensics</button>
      </div>
    `;

    const inspectBtn = card.querySelector('.btn-inspect') as HTMLButtonElement;
    inspectBtn.onclick = () => openInspector(res);

    candidateList.appendChild(card);
  });
}

// Open Playfield Inspector Modal
function openInspector(res: ComparisonResult) {
  if (!currentTargetBeatmap || !res.candidateBeatmap) return;

  const r = getOrCreateRenderer();
  modalTitle.textContent = `Comparing: ${currentTargetBeatmap.metadata.version} vs ${res.candidateVersion} (${res.candidateCreator})`;
  
  r.setMaps(currentTargetBeatmap, res.candidateBeatmap, res.segments);
  r.handleResize();

  // Populate flagged segments list
  segmentsContainer.innerHTML = '';
  if (res.segments.length === 0) {
    segmentsContainer.innerHTML = `
      <div style="color: var(--color-text-muted); font-size: 13px; text-align: center; padding: 10px;">
        No continuous stolen object sequences detected. Playfield overlay shows notes in real-time.
      </div>
    `;
  } else {
    res.segments.forEach((seg, idx) => {
      const item = document.createElement('div');
      item.className = 'segment-item';
      item.innerHTML = `
        <div>
          <strong style="color: #fb7185;">#${idx + 1} Flagged Pattern</strong>
          <span style="color: var(--color-text-muted); margin-left: 8px;">${seg.description}</span>
        </div>
        <span style="font-family: var(--font-mono); color: var(--color-cyan); font-size: 12px;">${formatTime(seg.startTime)}</span>
      `;
      item.onclick = () => {
        r.pause();
        btnPlayToggle.textContent = 'Play';
        r.setTime(Math.max(0, seg.startTime - 400));
      };
      segmentsContainer.appendChild(item);
    });
  }

  inspectorModal.style.display = 'flex';
}

// Event Listeners
btnAnalyze.addEventListener('click', () => {
  analyzeString(mapInput.value);
});

mapInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    analyzeString(mapInput.value);
  }
});

// Dropzone Events
dropzone.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) {
    handleFile(fileInput.files[0]);
  }
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer && e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

// Preset Chips
document.querySelectorAll('.preset-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const id = chip.getAttribute('data-id');
    if (id) {
      mapInput.value = id;
      analyzeString(id);
    }
  });
});

// Inspector Modal Controls
btnCloseModal.addEventListener('click', () => {
  renderer?.pause();
  inspectorModal.style.display = 'none';
});

inspectorModal.addEventListener('click', (e) => {
  if (e.target === inspectorModal) {
    renderer?.pause();
    inspectorModal.style.display = 'none';
  }
});

btnCloseOszModal.addEventListener('click', () => {
  oszModal.style.display = 'none';
});

timelineSlider.addEventListener('input', () => {
  if (renderer) {
    const dur = renderer.getDuration();
    const targetMs = (parseFloat(timelineSlider.value) / 1000) * dur;
    renderer.setTime(targetMs);
  }
});

btnPlayToggle.addEventListener('click', () => {
  if (renderer) {
    const playing = renderer.togglePlay();
    btnPlayToggle.textContent = playing ? 'Pause' : 'Play';
  }
});

function setSpeed(rate: number, activeBtn: HTMLButtonElement) {
  renderer?.setPlaybackRate(rate);
  [btnSpeed05, btnSpeed10, btnSpeed20].forEach((b) => (b.style.borderColor = 'var(--border-subtle)'));
  activeBtn.style.borderColor = 'var(--color-cyan)';
}

btnSpeed05.addEventListener('click', () => setSpeed(0.5, btnSpeed05));
btnSpeed10.addEventListener('click', () => setSpeed(1.0, btnSpeed10));
btnSpeed20.addEventListener('click', () => setSpeed(2.0, btnSpeed20));

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

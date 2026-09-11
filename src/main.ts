import './style.css';
import { StealEngine } from './core/engine';
import { PlayfieldRenderer } from './core/renderer';
import { extractOsz, ExtractedOsz } from './core/archive';
import { ParsedBeatmap, ComparisonResult, AnalysisProgress, getModeName } from './core/types';
import { formatTime } from './core/detector';
import { getCoverUrl, getPreviewAudioUrl, getFullAudioUrl, getBeatmapMirrorUrl } from './api/hinamizawa';

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
const btnTargetPlayer = document.getElementById('btn-target-player') as HTMLButtonElement;
const targetMirrorLink = document.getElementById('target-mirror-link') as HTMLAnchorElement;

const overallVerdictPill = document.getElementById('overall-verdict-pill') as HTMLElement;
const candidateList = document.getElementById('candidate-list') as HTMLElement;

// Inspector Modal Elements
const inspectorModal = document.getElementById('inspector-modal') as HTMLElement;
const btnCloseModal = document.getElementById('btn-close-modal') as HTMLButtonElement;
const modalTitle = document.getElementById('modal-title') as HTMLElement;
const btnTabSplit = document.getElementById('btn-tab-split') as HTMLButtonElement;
const btnTabOverlay = document.getElementById('btn-tab-overlay') as HTMLButtonElement;
const btnTabTarget = document.getElementById('btn-tab-target') as HTMLButtonElement;
const btnTabCandidate = document.getElementById('btn-tab-candidate') as HTMLButtonElement;
const modalLoadingOverlay = document.getElementById('modal-loading-overlay') as HTMLElement;
const viewSplit = document.getElementById('view-split') as HTMLElement;
const viewOverlay = document.getElementById('view-overlay') as HTMLElement;
const canvasTarget = document.getElementById('canvas-target') as HTMLCanvasElement;
const canvasCandidate = document.getElementById('canvas-candidate') as HTMLCanvasElement;
const canvasOverlay = document.getElementById('canvas-overlay') as HTMLCanvasElement;
const splitTargetName = document.getElementById('split-target-name') as HTMLElement;
const splitTargetStats = document.getElementById('split-target-stats') as HTMLElement;
const splitCandidateName = document.getElementById('split-candidate-name') as HTMLElement;
const splitCandidateStats = document.getElementById('split-candidate-stats') as HTMLElement;
const segmentsCountBadge = document.getElementById('segments-count-badge') as HTMLElement;
const timelineSlider = document.getElementById('timeline-slider') as HTMLInputElement;
const timeDisplay = document.getElementById('time-display') as HTMLElement;
const btnPlayToggle = document.getElementById('btn-play-toggle') as HTMLButtonElement;
const btnSpeed05 = document.getElementById('btn-speed-05') as HTMLButtonElement;
const btnSpeed10 = document.getElementById('btn-speed-10') as HTMLButtonElement;
const btnSpeed20 = document.getElementById('btn-speed-20') as HTMLButtonElement;
const modalVolumeSlider = document.getElementById('modal-volume-slider') as HTMLInputElement;
const modalVolumeVal = document.getElementById('modal-volume-val') as HTMLElement;
const segmentsContainer = document.getElementById('segments-container') as HTMLElement;

// OSZ Diff Picker Elements
const oszModal = document.getElementById('osz-modal') as HTMLElement;
const btnCloseOszModal = document.getElementById('btn-close-osz-modal') as HTMLButtonElement;
const oszDiffList = document.getElementById('osz-diff-list') as HTMLElement;

let renderer: PlayfieldRenderer | null = null;
let currentTargetBeatmap: ParsedBeatmap | null = null;
let currentTargetBeatmapId: number = 0;
let currentTargetSetId: number = 0;
let currentComparisonResult: ComparisonResult | null = null;
let activeOszData: ExtractedOsz | null = null;

// Initialize gentle default volume (20%)
audioPreview.volume = 0.2;
if (modalVolumeSlider && modalVolumeVal) {
  modalVolumeSlider.value = '20';
  modalVolumeVal.textContent = '20%';
  modalVolumeSlider.addEventListener('input', () => {
    const v = parseInt(modalVolumeSlider.value, 10) / 100;
    audioPreview.volume = v;
    modalVolumeVal.textContent = `${modalVolumeSlider.value}%`;
  });
  audioPreview.addEventListener('volumechange', () => {
    const pct = Math.round(audioPreview.volume * 100);
    modalVolumeSlider.value = pct.toString();
    modalVolumeVal.textContent = `${pct}%`;
  });
}

// Initialize Playfield Renderer
function getOrCreateRenderer(): PlayfieldRenderer {
  if (!renderer) {
    renderer = new PlayfieldRenderer({
      targetCanvas: canvasTarget,
      candidateCanvas: canvasCandidate,
      overlayCanvas: canvasOverlay,
    });
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
    currentTargetBeatmapId = analysis.targetBeatmapId || 0;
    displayResults(analysis.targetBeatmap, analysis.targetSetId, currentTargetBeatmapId, analysis.results);
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
      currentTargetBeatmapId = analysis.targetBeatmapId || 0;
      displayResults(analysis.targetBeatmap, analysis.targetSetId, currentTargetBeatmapId, analysis.results);
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
    currentTargetBeatmapId = analysis.targetBeatmapId || 0;
    displayResults(analysis.targetBeatmap, analysis.targetSetId, currentTargetBeatmapId, analysis.results);
  } catch (err: any) {
    alert(`Analysis failed: ${err.message || err}`);
    progressCard.style.display = 'none';
  } finally {
    btnAnalyze.disabled = false;
  }
}

// Display analysis results
function displayResults(target: ParsedBeatmap, setId: number, beatmapId: number, results: ComparisonResult[]) {
  resultsSection.style.display = 'grid';

  const modeName = getModeName(target.mode);

  // Target card
  targetCover.src = setId ? getCoverUrl(setId) : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>';
  targetTitle.textContent = target.metadata.title;
  targetArtist.innerHTML = `${escapeHtml(target.metadata.artist)} • mapped by <strong>${escapeHtml(target.metadata.creator)}</strong> <span class="badge badge-cyan" style="margin-left: 6px;">${modeName}</span>`;

  statDiff.textContent = `${target.metadata.version || 'Normal'} (${target.starRating.toFixed(2)}★)`;
  statBpm.textContent = `${target.bpm}`;
  statCs.textContent = `${target.difficulty.cs}`;
  statAr.textContent = `${target.difficulty.ar}`;
  statObjs.textContent = `${target.hitObjects.length}`;
  statLen.textContent = formatTime(target.durationMs);

  currentTargetSetId = setId;

  // Configure mirror link for target (points strictly to Hinamizawa mirror)
  if (targetMirrorLink) {
    if (beatmapId) {
      targetMirrorLink.href = getBeatmapMirrorUrl(beatmapId);
      targetMirrorLink.style.display = 'inline';
    } else {
      targetMirrorLink.style.display = 'none';
    }
  }

  // Configure Audio Playback (Local Blob or Hinamizawa full music stream)
  if (target.audioBlobUrl) {
    audioPreview.src = target.audioBlobUrl;
    audioPreview.style.display = 'block';
  } else if (setId) {
    // Full audio stream directly from mirror.hinamizawa.ai
    audioPreview.src = getFullAudioUrl(setId);
    audioPreview.onerror = () => {
      audioPreview.src = getPreviewAudioUrl(setId);
    };
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
        <p style="font-size: 16px;">No other ${modeName} maps for this song found on the mirror.</p>
        <p style="font-size: 13px; margin-top: 6px;">The map appears to be unique in this game mode or the song has not been mapped elsewhere.</p>
      </div>
    `;
    return;
  }

  // Cache first result as active comparison
  currentComparisonResult = results[0];

  results.forEach((res) => {
    const card = document.createElement('div');
    card.className = `candidate-card ${res.overallSuspicionScore >= 50 ? 'flagged' : ''}`;

    let scoreColor = '#34d399';
    if (res.overallSuspicionScore >= 75) scoreColor = '#fb7185';
    else if (res.overallSuspicionScore >= 45) scoreColor = '#fbbf24';
    else if (res.overallSuspicionScore >= 25) scoreColor = '#38bdf8';

    const candModeName = getModeName(res.candidateMode);

    card.innerHTML = `
      <img class="candidate-thumb" src="${res.candidateCoverUrl || ''}" alt="Cover" onerror="this.style.opacity='0.2'">
      <div class="candidate-info">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
          <span class="badge badge-cyan" style="font-size: 10px; padding: 2px 6px;">${candModeName}</span>
          <span class="badge" style="font-size: 10px; padding: 2px 6px; color: #fbbf24; border-color: rgba(245,158,11,0.3);">★ ${res.candidateDifficultyRating.toFixed(2)}</span>
          <h4 style="margin: 0;">${escapeHtml(res.candidateTitle)} [${escapeHtml(res.candidateVersion)}]</h4>
        </div>
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
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="btn-inspect-solo btn-ctrl" style="padding: 6px 10px; font-size: 12px; color: #fb7185; border-color: rgba(244,63,94,0.3);" title="Play this candidate map in integrated Web Player">▶ Play</button>
          <a href="${getBeatmapMirrorUrl(res.candidateBeatmapId)}" target="_blank" rel="noopener" class="btn-ctrl" style="text-decoration: none; padding: 6px 10px; font-size: 12px;" title="View on Hinamizawa mirror">Mirror ↗</a>
          <button class="btn-inspect">Inspect Forensics</button>
        </div>
      </div>
    `;

    const inspectBtn = card.querySelector('.btn-inspect') as HTMLButtonElement;
    inspectBtn.onclick = () => openInspector(res, 'split');

    const inspectSoloBtn = card.querySelector('.btn-inspect-solo') as HTMLButtonElement;
    inspectSoloBtn.onclick = () => openInspector(res, 'candidate');

    candidateList.appendChild(card);
  });
}

function switchViewMode(mode: 'split' | 'overlay' | 'target' | 'candidate') {
  const r = getOrCreateRenderer();

  if (mode === 'split') {
    viewSplit.style.display = 'flex';
    viewOverlay.style.display = 'none';
    const targetCard = viewSplit.querySelector('.target-card') as HTMLElement;
    const candidateCard = viewSplit.querySelector('.candidate-card') as HTMLElement;
    if (targetCard) targetCard.style.display = 'flex';
    if (candidateCard) candidateCard.style.display = 'flex';
  } else if (mode === 'overlay') {
    viewSplit.style.display = 'none';
    viewOverlay.style.display = 'flex';
  } else if (mode === 'target') {
    viewSplit.style.display = 'flex';
    viewOverlay.style.display = 'none';
    const targetCard = viewSplit.querySelector('.target-card') as HTMLElement;
    const candidateCard = viewSplit.querySelector('.candidate-card') as HTMLElement;
    if (targetCard) targetCard.style.display = 'flex';
    if (candidateCard) candidateCard.style.display = 'none';
  } else if (mode === 'candidate') {
    viewSplit.style.display = 'flex';
    viewOverlay.style.display = 'none';
    const targetCard = viewSplit.querySelector('.target-card') as HTMLElement;
    const candidateCard = viewSplit.querySelector('.candidate-card') as HTMLElement;
    if (targetCard) targetCard.style.display = 'none';
    if (candidateCard) candidateCard.style.display = 'flex';
  }

  r.setViewMode(mode);

  [btnTabSplit, btnTabOverlay, btnTabTarget, btnTabCandidate].forEach((b) => {
    if (!b) return;
    b.style.background = 'rgba(255, 255, 255, 0.08)';
    b.style.color = '#cbd5e1';
    b.style.fontWeight = 'normal';
    b.style.border = '1px solid var(--border-subtle)';
  });

  const activeBtn =
    mode === 'split' ? btnTabSplit :
    mode === 'overlay' ? btnTabOverlay :
    mode === 'target' ? btnTabTarget :
    btnTabCandidate;

  if (activeBtn) {
    activeBtn.style.background =
      mode === 'candidate' ? '#fb7185' :
      mode === 'overlay' ? '#10b981' :
      'var(--color-cyan)';
    activeBtn.style.color = '#000';
    activeBtn.style.fontWeight = '700';
    activeBtn.style.border = 'none';
  }
}

if (btnTabSplit) btnTabSplit.onclick = () => switchViewMode('split');
if (btnTabOverlay) btnTabOverlay.onclick = () => switchViewMode('overlay');
if (btnTabTarget) btnTabTarget.onclick = () => switchViewMode('target');
if (btnTabCandidate) btnTabCandidate.onclick = () => switchViewMode('candidate');

if (btnTargetPlayer) {
  btnTargetPlayer.onclick = () => {
    if (!currentTargetBeatmap) return;
    const fallbackRes: ComparisonResult = currentComparisonResult || {
      candidateSetId: currentTargetSetId,
      candidateBeatmapId: currentTargetBeatmapId,
      candidateTitle: currentTargetBeatmap.metadata.title,
      candidateArtist: currentTargetBeatmap.metadata.artist,
      candidateCreator: currentTargetBeatmap.metadata.creator,
      candidateVersion: currentTargetBeatmap.metadata.version,
      candidateMode: currentTargetBeatmap.mode,
      candidateDifficultyRating: currentTargetBeatmap.starRating,
      candidateCoverUrl: currentTargetSetId ? getCoverUrl(currentTargetSetId) : '',
      overallSuspicionScore: 0,
      rhythmOverlapPercentage: 0,
      spatialOverlapPercentage: 0,
      sliderGeometryOverlapPercentage: 0,
      patternStreakCount: 0,
      longestStreak: 0,
      verdict: 'CLEAN',
      segments: [],
      candidateBeatmap: currentTargetBeatmap,
    };
    openInspector(fallbackRes, 'target');
  };
}

// Open Playfield Inspector Modal with Preload Gate
async function openInspector(
  res: ComparisonResult,
  initialMode: 'split' | 'overlay' | 'target' | 'candidate' = 'split'
) {
  if (!currentTargetBeatmap || !res.candidateBeatmap) return;
  currentComparisonResult = res;

  // Display modal immediately with loading overlay to prevent jitter
  inspectorModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (modalLoadingOverlay) modalLoadingOverlay.style.display = 'flex';

  const candModeName = getModeName(res.candidateMode);
  modalTitle.textContent = `[${candModeName}] ${currentTargetBeatmap.metadata.version} vs ${res.candidateVersion} (${res.candidateCreator})`;

  // Populate card header details
  if (splitTargetName) {
    splitTargetName.textContent = currentTargetBeatmap.metadata.version;
  }
  if (splitTargetStats) {
    const diff = currentTargetBeatmap.difficulty;
    splitTargetStats.textContent = `CS ${diff.cs.toFixed(1)} | AR ${diff.ar.toFixed(1)} | OD ${diff.od.toFixed(1)} | ${currentTargetBeatmap.starRating.toFixed(2)}★`;
  }
  if (splitCandidateName) {
    splitCandidateName.textContent = `${res.candidateVersion} (${res.candidateCreator})`;
  }
  if (splitCandidateStats) {
    const diff = res.candidateBeatmap.difficulty;
    splitCandidateStats.textContent = `CS ${diff.cs.toFixed(1)} | AR ${diff.ar.toFixed(1)} | OD ${diff.od.toFixed(1)} | ${res.candidateDifficultyRating.toFixed(2)}★ | ${res.overallSuspicionScore}% MATCH`;
  }
  if (segmentsCountBadge) {
    segmentsCountBadge.textContent = `${res.segments.length} Sequences`;
  }

  // Populate flagged segments list with high-contrast, readable cards
  segmentsContainer.innerHTML = '';
  if (res.segments.length === 0) {
    segmentsContainer.innerHTML = `
      <div style="color: var(--color-text-muted); font-size: 13px; text-align: center; padding: 14px;">
        No continuous stolen object sequences detected. Playfield monitors notes in real-time.
      </div>
    `;
  } else {
    res.segments.forEach((seg, idx) => {
      const item = document.createElement('div');
      item.className = 'segment-item';
      item.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="seg-badge-danger">#${idx + 1} COPIED PATTERN</span>
            <span class="seg-time-pill">${formatTime(seg.startTime)} – ${formatTime(seg.endTime)}</span>
            <span style="font-size: 11px; color: #34d399; font-weight: 700;">${seg.objectCount} objects</span>
          </div>
          <div style="color: #cbd5e1; font-size: 12px; margin-top: 2px;">
            ${seg.description}
          </div>
        </div>
        <button class="btn-ctrl" style="padding: 4px 10px; font-size: 11px; color: var(--color-cyan); border-color: rgba(6,182,212,0.3); white-space: nowrap;">▶ Jump</button>
      `;
      item.onclick = () => {
        const r = getOrCreateRenderer();
        r.pause();
        btnPlayToggle.textContent = 'Play';
        r.setTime(Math.max(0, seg.startTime - 350));
        document.querySelectorAll('.segment-item').forEach((si) => si.classList.remove('active'));
        item.classList.add('active');
      };
      segmentsContainer.appendChild(item);
    });
  }

  // Pre-buffer audio stream before starting playback
  const targetAudioUrl =
    currentTargetBeatmap?.audioBlobUrl ||
    (currentTargetSetId ? getFullAudioUrl(currentTargetSetId) : '');

  if (targetAudioUrl && audioPreview.src !== targetAudioUrl) {
    audioPreview.src = targetAudioUrl;
    audioPreview.load();
  }

  // Preload gate: wait for audio readyState or max 1.0s timeout
  await new Promise<void>((resolve) => {
    if (!targetAudioUrl || audioPreview.readyState >= 2) {
      resolve();
      return;
    }
    let finished = false;
    const onReady = () => {
      if (!finished) {
        finished = true;
        audioPreview.removeEventListener('canplay', onReady);
        audioPreview.removeEventListener('loadeddata', onReady);
        audioPreview.removeEventListener('error', onReady);
        resolve();
      }
    };
    audioPreview.addEventListener('canplay', onReady);
    audioPreview.addEventListener('loadeddata', onReady);
    audioPreview.addEventListener('error', onReady);
    setTimeout(onReady, 1000);
  });

  // Ready! Hide preloader and render playfields
  if (modalLoadingOverlay) modalLoadingOverlay.style.display = 'none';

  const r = getOrCreateRenderer();
  r.handleResize();
  r.setAudio(audioPreview);
  r.setMaps(currentTargetBeatmap, res.candidateBeatmap, res.segments);
  switchViewMode(initialMode);
  btnPlayToggle.textContent = 'Play';
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
function closeInspector() {
  renderer?.pause();
  inspectorModal.style.display = 'none';
  document.body.style.overflow = '';
}

btnCloseModal.addEventListener('click', closeInspector);

inspectorModal.addEventListener('click', (e) => {
  if (e.target === inspectorModal) {
    closeInspector();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && inspectorModal.style.display === 'flex') {
    closeInspector();
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

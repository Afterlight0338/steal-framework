import { ParsedBeatmap, HitObject, MatchSegment, CurvePoint } from './types';

export type PlayfieldViewMode = 'split' | 'overlay' | 'target' | 'candidate';

export interface PlayfieldCanvases {
  targetCanvas: HTMLCanvasElement;
  candidateCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
}

export class PlayfieldRenderer {
  private canvases: PlayfieldCanvases;
  private targetCtx: CanvasRenderingContext2D;
  private candidateCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;

  private targetMap: ParsedBeatmap | null = null;
  private candidateMap: ParsedBeatmap | null = null;
  private segments: MatchSegment[] = [];

  private viewMode: PlayfieldViewMode = 'split';

  private currentTime = 0;
  private approachTime = 600; // AR window in ms
  private isPlaying = false;
  private playbackRate = 1.0;
  private lastAnimFrameTime = 0;
  private animFrameId: number | null = null;

  private audioElement: HTMLAudioElement | null = null;
  private onTimeUpdateCallback?: (time: number) => void;

  constructor(canvases: PlayfieldCanvases) {
    this.canvases = canvases;
    const tCtx = canvases.targetCanvas.getContext('2d');
    const cCtx = canvases.candidateCanvas.getContext('2d');
    const oCtx = canvases.overlayCanvas.getContext('2d');

    if (!tCtx || !cCtx || !oCtx) {
      throw new Error('Could not get 2D canvas contexts for playfields');
    }

    this.targetCtx = tCtx;
    this.candidateCtx = cCtx;
    this.overlayCtx = oCtx;

    this.handleResize();
  }

  public setViewMode(mode: PlayfieldViewMode) {
    this.viewMode = mode;
    this.handleResize();
    this.render();
  }

  public getViewMode(): PlayfieldViewMode {
    return this.viewMode;
  }

  public setAudio(audio: HTMLAudioElement | null) {
    this.audioElement = audio;
    if (this.audioElement) {
      this.audioElement.playbackRate = this.playbackRate;
      this.audioElement.volume = 0.2; // comfortable gentle default volume
    }
  }

  public setMaps(
    target: ParsedBeatmap | null | undefined,
    candidate: ParsedBeatmap | null | undefined,
    segments: MatchSegment[] = []
  ) {
    this.targetMap = target || null;
    this.candidateMap = candidate || null;
    this.segments = segments;

    // Pre-tag hit objects that belong to detected plagiarized segments
    const flagObjects = (map: ParsedBeatmap | null) => {
      if (!map) return;
      for (const obj of map.hitObjects) {
        obj.isFlagged = segments.some(
          (seg) => obj.time >= seg.startTime - 80 && obj.time <= seg.endTime + 80
        );
      }
    };
    flagObjects(this.targetMap);
    flagObjects(this.candidateMap);

    // Initial seek point: start at the first flagged stolen segment (minus 400ms), or first object
    if (segments && segments.length > 0) {
      this.currentTime = Math.max(0, segments[0].startTime - 400);
    } else if (target && target.hitObjects.length > 0) {
      this.currentTime = Math.max(0, target.hitObjects[0].time - 300);
    } else if (candidate && candidate.hitObjects.length > 0) {
      this.currentTime = Math.max(0, candidate.hitObjects[0].time - 300);
    } else {
      this.currentTime = 0;
    }

    if (target) {
      this.approachTime = this.calculateApproachTime(target.difficulty.ar);
    } else if (candidate) {
      this.approachTime = this.calculateApproachTime(candidate.difficulty.ar);
    }

    if (this.audioElement) {
      try {
        this.audioElement.currentTime = this.currentTime / 1000;
      } catch (_) {}
    }

    this.handleResize();
    this.render();
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(this.currentTime);
    }
  }

  public setOnTimeUpdate(cb: (time: number) => void) {
    this.onTimeUpdateCallback = cb;
  }

  public setTime(timeMs: number) {
    this.currentTime = Math.max(0, timeMs);
    if (this.audioElement) {
      try {
        this.audioElement.currentTime = this.currentTime / 1000;
      } catch (_) {}
    }
    this.render();
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(this.currentTime);
    }
  }

  public getTime(): number {
    return this.currentTime;
  }

  public getDuration(): number {
    const tDur = this.targetMap?.hitObjects.slice(-1)[0]?.endTime || 0;
    const cDur = this.candidateMap?.hitObjects.slice(-1)[0]?.endTime || 0;
    return Math.max(tDur, cDur, 1000);
  }

  public play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.lastAnimFrameTime = performance.now();

    if (this.audioElement) {
      try {
        this.audioElement.currentTime = this.currentTime / 1000;
        this.audioElement.playbackRate = this.playbackRate;
        this.audioElement.play().catch(() => {});
      } catch (_) {}
    }

    this.loop();
  }

  public pause() {
    this.isPlaying = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.audioElement) {
      try {
        this.audioElement.pause();
      } catch (_) {}
    }
  }

  public togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
    return this.isPlaying;
  }

  public setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    if (this.audioElement) {
      this.audioElement.playbackRate = rate;
    }
  }

  // Smooth 60 FPS clock synchronized with audio
  private loop = () => {
    if (!this.isPlaying) return;
    const now = performance.now();
    const dt = (now - this.lastAnimFrameTime) * this.playbackRate;
    this.lastAnimFrameTime = now;

    if (this.audioElement && !this.audioElement.paused && !this.audioElement.ended) {
      const audioTime = this.audioElement.currentTime * 1000;
      const clockDiff = audioTime - this.currentTime;

      if (Math.abs(clockDiff) > 150) {
        // Snap if large seek or audio jump
        this.currentTime = audioTime;
      } else if (Math.abs(clockDiff) > 20) {
        // Gentle lerp towards audio clock to eliminate micro-stutter
        this.currentTime += dt + clockDiff * 0.12;
      } else {
        this.currentTime += dt;
      }
    } else {
      this.currentTime += dt;
    }

    if (this.currentTime > this.getDuration()) {
      this.currentTime = 0;
      if (this.audioElement) {
        try {
          this.audioElement.currentTime = 0;
        } catch (_) {}
      }
    }

    this.render();
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(this.currentTime);
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private calculateApproachTime(ar: number): number {
    if (ar < 5) {
      return 1200 + 600 * ((5 - ar) / 5);
    } else if (ar === 5) {
      return 1200;
    } else {
      return 1200 - 750 * ((ar - 5) / 5);
    }
  }

  public handleResize() {
    const resizeCanvas = (canvas: HTMLCanvasElement) => {
      let w = canvas.clientWidth;
      let h = canvas.clientHeight;
      if (!w || !h) {
        const parent = canvas.parentElement;
        if (parent) {
          w = parent.clientWidth;
          h = parent.clientHeight || Math.round((w * 3) / 4);
        }
      }
      if (!w) w = 480;
      if (!h) h = 320;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    if (this.viewMode === 'split') {
      resizeCanvas(this.canvases.targetCanvas);
      resizeCanvas(this.canvases.candidateCanvas);
    } else if (this.viewMode === 'overlay') {
      resizeCanvas(this.canvases.overlayCanvas);
    } else if (this.viewMode === 'target') {
      resizeCanvas(this.canvases.targetCanvas);
    } else if (this.viewMode === 'candidate') {
      resizeCanvas(this.canvases.candidateCanvas);
    }
  }

  public render() {
    if (this.viewMode === 'split') {
      this.renderPlayfield(
        this.targetCtx,
        this.canvases.targetCanvas,
        this.targetMap,
        '#06b6d4',
        'rgba(6, 182, 212, 0.35)',
        'TARGET'
      );
      this.renderPlayfield(
        this.candidateCtx,
        this.canvases.candidateCanvas,
        this.candidateMap,
        '#f43f5e',
        'rgba(244, 63, 94, 0.35)',
        'SUSPECT'
      );
    } else if (this.viewMode === 'overlay') {
      this.renderDualOverlay(this.overlayCtx, this.canvases.overlayCanvas);
    } else if (this.viewMode === 'target') {
      this.renderPlayfield(
        this.targetCtx,
        this.canvases.targetCanvas,
        this.targetMap,
        '#06b6d4',
        'rgba(6, 182, 212, 0.35)',
        'TARGET'
      );
    } else if (this.viewMode === 'candidate') {
      this.renderPlayfield(
        this.candidateCtx,
        this.canvases.candidateCanvas,
        this.candidateMap,
        '#f43f5e',
        'rgba(244, 63, 94, 0.35)',
        'SUSPECT'
      );
    }
  }

  // Render a single map onto a dedicated canvas
  private renderPlayfield(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    map: ParsedBeatmap | null,
    primaryColor: string,
    fillColor: string,
    badgeText: string
  ) {
    const width = canvas.width;
    const height = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Deep modern dark backdrop
    ctx.fillStyle = '#040711';
    ctx.fillRect(0, 0, width, height);

    if (!map) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No beatmap data loaded', width / 2, height / 2);
      return;
    }

    const osuW = 512;
    const osuH = 384;
    const scale = Math.min((width * 0.9) / osuW, (height * 0.88) / osuH);
    const offsetX = (width - osuW * scale) / 2;
    const offsetY = (height - osuH * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Playfield outer glow and boundary
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 6;
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, osuW, osuH);
    ctx.shadowBlur = 0;

    // Playfield subtle coordinate grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    ctx.moveTo(256, 0); ctx.lineTo(256, 384);
    ctx.moveTo(0, 192); ctx.lineTo(512, 192);
    ctx.stroke();

    // Mode-specific rendering
    if (map.mode === 1) {
      this.renderTaikoNotes(ctx, map, primaryColor, 192, 100, osuW);
    } else if (map.mode === 2) {
      this.renderCatchFruits(ctx, map, primaryColor, 340);
    } else if (map.mode === 3) {
      this.renderManiaNotes(ctx, map, primaryColor, (osuW - 256) / 2, 64, 330);
    } else {
      this.renderStandardObjects(ctx, map, primaryColor, fillColor, scale);
    }

    ctx.restore();

    // Corner badge
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = primaryColor;
    ctx.textAlign = 'left';
    ctx.fillText(`${badgeText} • ${map.metadata.version}`, 12, 18);
    ctx.restore();
  }

  // Render Dual Overlay on single canvas
  private renderDualOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const width = canvas.width;
    const height = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Dark backdrop
    ctx.fillStyle = '#03050c';
    ctx.fillRect(0, 0, width, height);

    const osuW = 512;
    const osuH = 384;
    const scale = Math.min((width * 0.92) / osuW, (height * 0.9) / osuH);
    const offsetX = (width - osuW * scale) / 2;
    const offsetY = (height - osuH * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Playfield border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, osuW, osuH);

    // Center cross
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    ctx.moveTo(256, 0); ctx.lineTo(256, 384);
    ctx.moveTo(0, 192); ctx.lineTo(512, 192);
    ctx.stroke();

    // Mode-specific overlay
    const mode = this.targetMap?.mode || this.candidateMap?.mode || 0;

    if (mode === 1) {
      if (this.candidateMap) this.renderTaikoNotes(ctx, this.candidateMap, '#f43f5e', 192, 100, osuW);
      if (this.targetMap) this.renderTaikoNotes(ctx, this.targetMap, '#06b6d4', 192, 100, osuW);
    } else if (mode === 2) {
      if (this.candidateMap) this.renderCatchFruits(ctx, this.candidateMap, '#f43f5e', 340);
      if (this.targetMap) this.renderCatchFruits(ctx, this.targetMap, '#06b6d4', 340);
    } else if (mode === 3) {
      if (this.candidateMap) this.renderManiaNotes(ctx, this.candidateMap, '#f43f5e', (osuW - 256) / 2, 64, 330);
      if (this.targetMap) this.renderManiaNotes(ctx, this.targetMap, '#06b6d4', (osuW - 256) / 2, 64, 330);
    } else {
      // Standard osu! Dual Overlay
      if (this.candidateMap) {
        this.renderStandardObjects(ctx, this.candidateMap, '#f43f5e', 'rgba(244, 63, 94, 0.3)', scale, true);
      }
      if (this.targetMap) {
        this.renderStandardObjects(ctx, this.targetMap, '#06b6d4', 'rgba(6, 182, 212, 0.3)', scale, false);
      }
    }

    ctx.restore();
  }

  // Standard osu! objects rendering (Circles with readable combo numbers, Sliders with animated balls, Stolen highlights)
  private renderStandardObjects(
    ctx: CanvasRenderingContext2D,
    map: ParsedBeatmap,
    primaryColor: string,
    fillColor: string,
    scale: number,
    isCandidateOverlay = false
  ) {
    const objs = map.hitObjects;
    const now = this.currentTime;
    const arWindow = this.approachTime;
    const cs = map.difficulty?.cs ?? 4;
    const circleRadius = Math.max(16, Math.min(48, 54.4 - 4.48 * cs));

    for (let i = objs.length - 1; i >= 0; i--) {
      const obj = objs[i];
      if (obj.time > now + arWindow) continue;
      if (obj.endTime < now - 140) continue;

      const timeUntilHit = obj.time - now;
      const progress = 1 - Math.max(0, timeUntilHit) / arWindow;

      let alpha = 1.0;
      if (timeUntilHit < 0) {
        alpha = Math.max(0, 1 - Math.abs(timeUntilHit) / 140);
      } else {
        alpha = Math.min(1, progress * 1.6);
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      // Draw Sliders
      if (obj.isSlider && obj.curvePoints && obj.curvePoints.length > 1) {
        const pts = obj.curvePoints;

        // Slider track body
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = circleRadius * 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = alpha * 0.35;

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let p = 1; p < pts.length; p++) {
          ctx.lineTo(pts[p].x, pts[p].y);
        }
        ctx.stroke();

        // Slider inner track border
        ctx.lineWidth = 3 / scale;
        ctx.globalAlpha = alpha * 0.9;
        ctx.stroke();

        // Slider tail circle
        const lastPt = pts[pts.length - 1];
        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, circleRadius * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2 / scale;
        ctx.stroke();

        // Animated Slider Ball if active
        if (now >= obj.time && now <= obj.endTime) {
          const totalDuration = Math.max(1, obj.endTime - obj.time);
          const rawProgress = (now - obj.time) / totalDuration;
          const repeats = obj.repeats || 1;
          const span = rawProgress * repeats;
          const isReverse = Math.floor(span) % 2 === 1;
          let spanProg = span % 1;
          if (isReverse) spanProg = 1 - spanProg;

          const ptIdx = Math.min(pts.length - 1, Math.floor(spanProg * (pts.length - 1)));
          const ballPt = pts[ptIdx];
          if (ballPt) {
            // Pulsing follow circle
            ctx.beginPath();
            ctx.arc(ballPt.x, ballPt.y, circleRadius * 1.3, 0, Math.PI * 2);
            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 2 / scale;
            ctx.globalAlpha = alpha * 0.6;
            ctx.stroke();

            // Ball center
            ctx.beginPath();
            ctx.arc(ballPt.x, ballPt.y, circleRadius * 0.65, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = alpha;
            ctx.fill();
            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 3 / scale;
            ctx.stroke();
          }
        }
      }

      // Draw Hit Circle Body
      ctx.globalAlpha = alpha;

      // Check if note is flagged as copied/stolen
      if (obj.isFlagged) {
        // High-visibility glowing Emerald Green indicator ring
        ctx.save();
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 14;
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 5 / scale;
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, circleRadius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Circle dark solid interior for crisp contrast
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, circleRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#080c18';
      ctx.fill();

      // Colored rim
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.lineWidth = (obj.isFlagged ? 4 : 3.5) / scale;
      ctx.strokeStyle = obj.isFlagged ? '#10b981' : primaryColor;
      ctx.stroke();

      // Combo Number (Authentic osu! readable number)
      const comboNum = obj.comboNumber ?? 1;
      const fontSize = Math.round(circleRadius * 0.82);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(comboNum), obj.x, obj.y + 1);

      // Approach Circle
      if (timeUntilHit > 0) {
        const approachRadius = circleRadius + circleRadius * 1.9 * (1 - progress);
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, Math.max(circleRadius, approachRadius), 0, Math.PI * 2);
        ctx.lineWidth = 2.5 / scale;
        ctx.strokeStyle = obj.isFlagged ? '#10b981' : primaryColor;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // MODE 1: Taiko
  private renderTaikoNotes(
    ctx: CanvasRenderingContext2D,
    map: ParsedBeatmap,
    color: string,
    trackY: number,
    hitX: number,
    osuW: number
  ) {
    const now = this.currentTime;
    const windowMs = 1200;

    for (const obj of map.hitObjects) {
      if (obj.time < now - 100 || obj.time > now + windowMs) continue;
      const progress = (obj.time - now) / windowMs;
      const x = hitX + progress * (osuW - hitX);

      const isBlue = (obj.hitSound & 2) !== 0 || (obj.hitSound & 8) !== 0;
      const noteColor = isBlue ? '#3b82f6' : '#ef4444';

      if (obj.isFlagged) {
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, trackY, 28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(x, trackY, 22, 0, Math.PI * 2);
      ctx.fillStyle = noteColor;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // MODE 2: Catch the Beat
  private renderCatchFruits(ctx: CanvasRenderingContext2D, map: ParsedBeatmap, color: string, catcherY: number) {
    const now = this.currentTime;
    const windowMs = 900;

    for (const obj of map.hitObjects) {
      if (obj.time < now - 100 || obj.time > now + windowMs) continue;
      const progress = 1 - (obj.time - now) / windowMs;
      const y = progress * catcherY;

      if (obj.isFlagged) {
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(obj.x, y, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(obj.x, y, 15, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // MODE 3: Mania
  private renderManiaNotes(
    ctx: CanvasRenderingContext2D,
    map: ParsedBeatmap,
    color: string,
    startX: number,
    colW: number,
    hitLineY: number
  ) {
    const now = this.currentTime;
    const windowMs = 800;

    for (const obj of map.hitObjects) {
      if (obj.endTime < now - 100 || obj.time > now + windowMs) continue;
      const col = Math.min(3, Math.max(0, Math.floor((obj.x * 4) / 512)));
      const cx = startX + col * colW;
      const progress = 1 - (obj.time - now) / windowMs;
      const y = progress * hitLineY;

      if (obj.isFlagged) {
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3;
        ctx.strokeRect(cx + 2, y - 10, colW - 4, 20);
        ctx.restore();
      }

      ctx.fillStyle = color;
      ctx.fillRect(cx + 4, y - 8, colW - 8, 16);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 4, y - 8, colW - 8, 16);
    }
  }
}

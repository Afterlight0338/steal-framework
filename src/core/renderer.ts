import { ParsedBeatmap, HitObject, MatchSegment } from './types';
import { StandardBeatmapPreviewer } from 'osu-beatmap-preview';

export type PlayfieldViewMode = 'overlay' | 'target' | 'candidate';

export class PlayfieldRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private targetMap: ParsedBeatmap | null = null;
  private candidateMap: ParsedBeatmap | null = null;
  private segments: MatchSegment[] = [];

  private viewMode: PlayfieldViewMode = 'overlay';
  private targetPreviewer: StandardBeatmapPreviewer | null = null;
  private candidatePreviewer: StandardBeatmapPreviewer | null = null;

  private currentTime = 0;
  private approachTime = 600; // AR preview window
  private isPlaying = false;
  private playbackRate = 1.0;
  private lastAnimFrameTime = 0;
  private animFrameId: number | null = null;

  private audioElement: HTMLAudioElement | null = null;
  private onTimeUpdateCallback?: (time: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');
    this.ctx = ctx;
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
      this.audioElement.volume = 0.2; // comfortable lower default volume
    }
  }

  public setMaps(target: ParsedBeatmap | null | undefined, candidate: ParsedBeatmap | null | undefined, segments: MatchSegment[] = []) {
    this.targetMap = target || null;
    this.candidateMap = candidate || null;
    this.segments = segments;

    // Dispose previous standalone previewers if any
    try {
      this.targetPreviewer?.dispose();
    } catch (_) {}
    this.targetPreviewer = null;

    try {
      this.candidatePreviewer?.dispose();
    } catch (_) {}
    this.candidatePreviewer = null;

    // Initialize in-browser osu web previewers for standard osu! maps
    if (this.targetMap?.rawText && this.targetMap.mode === 0) {
      try {
        this.targetPreviewer = new StandardBeatmapPreviewer(this.canvas, {
          useBeatmapPreviewTime: false,
        });
        this.targetPreviewer.loadBeatmapText(this.targetMap.rawText);
      } catch (err) {
        console.warn('Could not initialize target standard previewer:', err);
      }
    }

    if (this.candidateMap?.rawText && this.candidateMap.mode === 0) {
      try {
        this.candidatePreviewer = new StandardBeatmapPreviewer(this.canvas, {
          useBeatmapPreviewTime: false,
        });
        this.candidatePreviewer.loadBeatmapText(this.candidateMap.rawText);
      } catch (err) {
        console.warn('Could not initialize candidate standard previewer:', err);
      }
    }

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
      this.audioElement.currentTime = this.currentTime / 1000;
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
      this.audioElement.currentTime = this.currentTime / 1000;
      this.audioElement.playbackRate = this.playbackRate;
      this.audioElement.play().catch(() => {});
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
      this.audioElement.pause();
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

  private loop = () => {
    if (!this.isPlaying) return;
    const now = performance.now();

    if (this.audioElement && !this.audioElement.paused && !this.audioElement.ended && Math.abs(this.audioElement.currentTime * 1000 - this.currentTime) < 2500) {
      this.currentTime = this.audioElement.currentTime * 1000;
    } else {
      const dt = (now - this.lastAnimFrameTime) * this.playbackRate;
      this.currentTime += dt;
    }

    this.lastAnimFrameTime = now;

    if (this.currentTime > this.getDuration()) {
      this.currentTime = 0;
      if (this.audioElement) {
        this.audioElement.currentTime = 0;
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
      return 1200 + 600 * (5 - ar) / 5;
    } else if (ar === 5) {
      return 1200;
    } else {
      return 1200 - 750 * (ar - 5) / 5;
    }
  }

  public handleResize() {
    let w = this.canvas.clientWidth;
    let h = this.canvas.clientHeight;
    if (!w || !h) {
      const parent = this.canvas.parentElement;
      if (parent) {
        w = parent.clientWidth;
        h = parent.clientHeight || Math.round((w * 9) / 16);
      }
    }
    if (!w) w = 960;
    if (!h) h = 540;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

    if (this.targetPreviewer) {
      try {
        this.targetPreviewer.resize(w, h, dpr);
      } catch (_) {}
    }
    if (this.candidatePreviewer) {
      try {
        this.candidatePreviewer.resize(w, h, dpr);
      } catch (_) {}
    }

    this.render();
  }

  public render() {
    if (this.viewMode === 'target') {
      if (this.targetPreviewer) {
        try {
          this.targetPreviewer.render(this.currentTime);
          return;
        } catch (e) {
          console.warn('Target previewer error, falling back:', e);
        }
      } else if (this.targetMap) {
        this.renderSingleMap(this.targetMap, '#06b6d4', 'rgba(6, 182, 212, 0.25)');
        return;
      }
    }

    if (this.viewMode === 'candidate') {
      if (this.candidatePreviewer) {
        try {
          this.candidatePreviewer.render(this.currentTime);
          return;
        } catch (e) {
          console.warn('Candidate previewer error, falling back:', e);
        }
      } else if (this.candidateMap) {
        this.renderSingleMap(this.candidateMap, '#f43f5e', 'rgba(244, 63, 94, 0.25)');
        return;
      }
    }

    // Default: Dual forensic comparison overlay
    this.renderOverlay();
  }

  private renderSingleMap(map: ParsedBeatmap, primaryColor: string, fillColor: string) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, width, height);

    const osuW = 512;
    const osuH = 384;
    const scale = Math.min((width * 0.9) / osuW, (height * 0.9) / osuH);
    const offsetX = (width - osuW * scale) / 2;
    const offsetY = (height - osuH * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, osuW, osuH);

    if (map.mode === 1) {
      this.renderTaikoNotes(ctx, map, primaryColor, 192, 100, osuW);
    } else if (map.mode === 2) {
      this.renderCatchFruits(ctx, map, primaryColor, 340);
    } else if (map.mode === 3) {
      this.renderManiaNotes(ctx, map, primaryColor, (osuW - 256) / 2, 64, 330);
    } else {
      this.renderStandardObjects(ctx, map, primaryColor, fillColor, 32, scale);
    }

    ctx.restore();
  }

  private renderOverlay() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear background
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, width, height);

    // osu! 4:3 playfield space: 512 x 384
    const osuW = 512;
    const osuH = 384;
    const scale = Math.min((width * 0.9) / osuW, (height * 0.9) / osuH);
    const offsetX = (width - osuW * scale) / 2;
    const offsetY = (height - osuH * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const mode = this.targetMap?.mode ?? this.candidateMap?.mode ?? 0;

    // Draw playfield frame
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, osuW, osuH);

    // Check if current time is inside a plagiarized segment
    const activeSegment = this.segments.find(
      (s) => this.currentTime >= s.startTime - 150 && this.currentTime <= s.endTime + 150
    );

    if (activeSegment) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
      ctx.fillRect(0, 0, osuW, osuH);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.lineWidth = 3 / scale;
      ctx.strokeRect(0, 0, osuW, osuH);
    }

    if (mode === 1) {
      // Taiko mode rendering
      this.renderTaikoField(ctx, osuW, osuH, scale);
    } else if (mode === 2) {
      // Catch mode rendering
      this.renderCatchField(ctx, osuW, osuH, scale);
    } else if (mode === 3) {
      // Mania mode rendering
      this.renderManiaField(ctx, osuW, osuH, scale);
    } else {
      // Standard osu! mode rendering
      this.renderStandardField(ctx, osuW, osuH, scale);
    }

    ctx.restore();
  }

  // MODE 0: Standard osu!
  private renderStandardField(ctx: CanvasRenderingContext2D, osuW: number, osuH: number, scale: number) {
    // Center crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(256, 0); ctx.lineTo(256, 384);
    ctx.moveTo(0, 192); ctx.lineTo(512, 192);
    ctx.stroke();

    const circleRadius = 32;

    if (this.candidateMap) {
      this.renderStandardObjects(ctx, this.candidateMap, '#f43f5e', 'rgba(244, 63, 94, 0.25)', circleRadius, scale);
    }
    if (this.targetMap) {
      this.renderStandardObjects(ctx, this.targetMap, '#06b6d4', 'rgba(6, 182, 212, 0.25)', circleRadius, scale);
    }
  }

  private renderStandardObjects(
    ctx: CanvasRenderingContext2D,
    map: ParsedBeatmap,
    primaryColor: string,
    fillColor: string,
    circleRadius: number,
    scale: number
  ) {
    const objs = map.hitObjects;
    const now = this.currentTime;
    const arWindow = this.approachTime;

    for (let i = objs.length - 1; i >= 0; i--) {
      const obj = objs[i];
      if (obj.time > now + arWindow) continue;
      if (obj.endTime < now - 150) continue;

      const timeUntilHit = obj.time - now;
      const progress = 1 - Math.max(0, timeUntilHit) / arWindow;

      let alpha = 1.0;
      if (timeUntilHit < 0) {
        alpha = Math.max(0, 1 - Math.abs(timeUntilHit) / 150);
      } else {
        alpha = Math.min(1, progress * 1.5);
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      // Draw Sliders
      if (obj.isSlider && obj.curvePoints && obj.curvePoints.length > 1) {
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = circleRadius * 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = alpha * 0.3;

        ctx.beginPath();
        ctx.moveTo(obj.curvePoints[0].x, obj.curvePoints[0].y);
        for (let p = 1; p < obj.curvePoints.length; p++) {
          ctx.lineTo(obj.curvePoints[p].x, obj.curvePoints[p].y);
        }
        ctx.stroke();

        ctx.lineWidth = 3 / scale;
        ctx.globalAlpha = alpha * 0.8;
        ctx.stroke();

        // Slider ball animation if active
        if (now >= obj.time && now <= obj.endTime) {
          const sliderDuration = obj.endTime - obj.time;
          const sliderProgress = (now - obj.time) / sliderDuration;
          const ptIdx = Math.min(obj.curvePoints.length - 1, Math.floor(sliderProgress * (obj.curvePoints.length - 1)));
          const ballPt = obj.curvePoints[ptIdx];
          if (ballPt) {
            ctx.beginPath();
            ctx.arc(ballPt.x, ballPt.y, circleRadius * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = primaryColor;
            ctx.fill();
          }
        }
      }

      // Draw Hit Circle
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, circleRadius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.lineWidth = 4 / scale;
      ctx.strokeStyle = primaryColor;
      ctx.stroke();

      // Approach Circle
      if (timeUntilHit > 0) {
        const approachRadius = circleRadius + (circleRadius * 2.2) * (1 - progress);
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, Math.max(circleRadius, approachRadius), 0, Math.PI * 2);
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = primaryColor;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // MODE 1: Taiko
  private renderTaikoField(ctx: CanvasRenderingContext2D, osuW: number, osuH: number, scale: number) {
    const trackY = 192;
    const hitX = 100;

    // Draw conveyor drum track
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, trackY - 45, osuW, 90);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeRect(0, trackY - 45, osuW, 90);

    // Hit target receptor
    ctx.beginPath();
    ctx.arc(hitX, trackY, 30, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 / scale;
    ctx.stroke();

    if (this.candidateMap) this.renderTaikoNotes(ctx, this.candidateMap, '#f43f5e', trackY, hitX, osuW);
    if (this.targetMap) this.renderTaikoNotes(ctx, this.targetMap, '#06b6d4', trackY, hitX, osuW);
  }

  private renderTaikoNotes(ctx: CanvasRenderingContext2D, map: ParsedBeatmap, color: string, trackY: number, hitX: number, osuW: number) {
    const now = this.currentTime;
    const windowMs = 1200;

    for (const obj of map.hitObjects) {
      if (obj.time < now - 100 || obj.time > now + windowMs) continue;
      const progress = (obj.time - now) / windowMs; // 0 at hitX, 1 at right edge
      const x = hitX + progress * (osuW - hitX);

      const isBlue = (obj.hitSound & 2) !== 0 || (obj.hitSound & 8) !== 0; // clap or whistle = katsu (blue)
      const noteColor = isBlue ? '#3b82f6' : '#ef4444';

      ctx.beginPath();
      ctx.arc(x, trackY, 24, 0, Math.PI * 2);
      ctx.fillStyle = noteColor;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // MODE 2: Catch the Beat
  private renderCatchField(ctx: CanvasRenderingContext2D, osuW: number, osuH: number, scale: number) {
    const catcherY = 340;
    // Catcher baseline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(0, catcherY); ctx.lineTo(osuW, catcherY);
    ctx.stroke();

    if (this.candidateMap) this.renderCatchFruits(ctx, this.candidateMap, '#f43f5e', catcherY);
    if (this.targetMap) this.renderCatchFruits(ctx, this.targetMap, '#06b6d4', catcherY);
  }

  private renderCatchFruits(ctx: CanvasRenderingContext2D, map: ParsedBeatmap, color: string, catcherY: number) {
    const now = this.currentTime;
    const windowMs = 900;

    for (const obj of map.hitObjects) {
      if (obj.time < now - 100 || obj.time > now + windowMs) continue;
      const progress = 1 - (obj.time - now) / windowMs; // 0 at top, 1 at catcherY
      const y = progress * catcherY;

      ctx.beginPath();
      ctx.arc(obj.x, y, 16, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // MODE 3: Mania
  private renderManiaField(ctx: CanvasRenderingContext2D, osuW: number, osuH: number, scale: number) {
    const colCount = 4;
    const colW = 64;
    const startX = (osuW - colCount * colW) / 2;
    const hitLineY = 330;

    // Highway columns
    for (let c = 0; c < colCount; c++) {
      const cx = startX + c * colW;
      ctx.fillStyle = c % 2 === 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(cx, 0, colW, osuH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.strokeRect(cx, 0, colW, osuH);
    }

    // Receptor line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3 / scale;
    ctx.beginPath();
    ctx.moveTo(startX, hitLineY); ctx.lineTo(startX + colCount * colW, hitLineY);
    ctx.stroke();

    if (this.candidateMap) this.renderManiaNotes(ctx, this.candidateMap, '#f43f5e', startX, colW, hitLineY);
    if (this.targetMap) this.renderManiaNotes(ctx, this.targetMap, '#06b6d4', startX, colW, hitLineY);
  }

  private renderManiaNotes(ctx: CanvasRenderingContext2D, map: ParsedBeatmap, color: string, startX: number, colW: number, hitLineY: number) {
    const now = this.currentTime;
    const windowMs = 800;

    for (const obj of map.hitObjects) {
      if (obj.endTime < now - 100 || obj.time > now + windowMs) continue;
      const col = Math.min(3, Math.max(0, Math.floor((obj.x * 4) / 512)));
      const cx = startX + col * colW;
      const progress = 1 - (obj.time - now) / windowMs;
      const y = progress * hitLineY;

      // Note body
      ctx.fillStyle = color;
      ctx.fillRect(cx + 4, y - 8, colW - 8, 16);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 4, y - 8, colW - 8, 16);
    }
  }
}

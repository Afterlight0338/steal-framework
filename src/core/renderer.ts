import { ParsedBeatmap, HitObject, MatchSegment } from './types';

export class PlayfieldRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private targetMap: ParsedBeatmap | null = null;
  private candidateMap: ParsedBeatmap | null = null;
  private segments: MatchSegment[] = [];

  private currentTime = 0;
  private approachTime = 600; // AR preview window
  private isPlaying = false;
  private playbackRate = 1.0;
  private lastAnimFrameTime = 0;
  private animFrameId: number | null = null;

  private onTimeUpdateCallback?: (time: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');
    this.ctx = ctx;
    this.handleResize();
  }

  public setMaps(target: ParsedBeatmap | null, candidate: ParsedBeatmap | null, segments: MatchSegment[] = []) {
    this.targetMap = target;
    this.candidateMap = candidate;
    this.segments = segments;

    if (target && target.hitObjects.length > 0) {
      this.currentTime = target.hitObjects[0].time;
      this.approachTime = this.calculateApproachTime(target.difficulty.ar);
    } else if (candidate && candidate.hitObjects.length > 0) {
      this.currentTime = candidate.hitObjects[0].time;
      this.approachTime = this.calculateApproachTime(candidate.difficulty.ar);
    } else {
      this.currentTime = 0;
    }

    this.render();
  }

  public setOnTimeUpdate(cb: (time: number) => void) {
    this.onTimeUpdateCallback = cb;
  }

  public setTime(timeMs: number) {
    this.currentTime = Math.max(0, timeMs);
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
    this.loop();
  }

  public pause() {
    this.isPlaying = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
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
  }

  private loop = () => {
    if (!this.isPlaying) return;
    const now = performance.now();
    const dt = (now - this.lastAnimFrameTime) * this.playbackRate;
    this.lastAnimFrameTime = now;

    this.currentTime += dt;
    if (this.currentTime > this.getDuration()) {
      this.currentTime = 0;
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
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.render();
  }

  public render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear background (osu! dark auditorium look)
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, width, height);

    // osu! 4:3 playfield space: 512 x 384
    const osuW = 512;
    const osuH = 384;
    const scale = Math.min((width * 0.9) / osuW, (height * 0.9) / osuH);
    const offsetX = (width - osuW * scale) / 2;
    const offsetY = (height - osuH * scale) / 2;

    // Draw playfield border with subtle grid
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, osuW, osuH);

    // Subtle center crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(256, 0); ctx.lineTo(256, 384);
    ctx.moveTo(0, 192); ctx.lineTo(512, 192);
    ctx.stroke();

    const circleRadius = 32; // Standard visual circle radius

    // Check if current time is inside a plagiarized segment
    const activeSegment = this.segments.find(
      (s) => this.currentTime >= s.startTime - 200 && this.currentTime <= s.endTime + 200
    );

    if (activeSegment) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
      ctx.fillRect(0, 0, osuW, osuH);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.lineWidth = 3 / scale;
      ctx.strokeRect(0, 0, osuW, osuH);
    }

    // Render candidate map objects first (in Crimson / Red `#f43f5e`)
    if (this.candidateMap) {
      this.renderMapObjects(ctx, this.candidateMap, '#f43f5e', 'rgba(244, 63, 94, 0.25)', circleRadius, scale);
    }

    // Render target map objects on top (in Cyan `#06b6d4`)
    if (this.targetMap) {
      this.renderMapObjects(ctx, this.targetMap, '#06b6d4', 'rgba(6, 182, 212, 0.25)', circleRadius, scale);
    }

    ctx.restore();
  }

  private renderMapObjects(
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

    // Filter objects active within approach window to completion
    for (let i = objs.length - 1; i >= 0; i--) {
      const obj = objs[i];
      if (obj.time > now + arWindow) continue;
      if (obj.endTime < now - 150) continue;

      const timeUntilHit = obj.time - now;
      const progress = 1 - Math.max(0, timeUntilHit) / arWindow; // 0 (start approach) -> 1 (hit time)

      // Fade in/out
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
        ctx.lineWidth = (circleRadius * 1.8);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = alpha * 0.35;

        ctx.beginPath();
        ctx.moveTo(obj.curvePoints[0].x, obj.curvePoints[0].y);
        for (let p = 1; p < obj.curvePoints.length; p++) {
          ctx.lineTo(obj.curvePoints[p].x, obj.curvePoints[p].y);
        }
        ctx.stroke();

        // Slider border
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 3 / scale;
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath();
        ctx.moveTo(obj.curvePoints[0].x, obj.curvePoints[0].y);
        for (let p = 1; p < obj.curvePoints.length; p++) {
          ctx.lineTo(obj.curvePoints[p].x, obj.curvePoints[p].y);
        }
        ctx.stroke();
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
}

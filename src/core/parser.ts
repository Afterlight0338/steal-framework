import { ParsedBeatmap, BeatmapMetadata, BeatmapDifficulty, TimingPoint, HitObject, CurvePoint } from './types';

export function parseOsuFile(content: string): ParsedBeatmap {
  const lines = content.split(/\r?\n/);
  
  const metadata: BeatmapMetadata = {
    title: '',
    titleUnicode: '',
    artist: '',
    artistUnicode: '',
    creator: '',
    version: '',
    source: '',
    tags: [],
    beatmapId: 0,
    beatmapSetId: 0,
    mode: 0,
  };

  const difficulty: BeatmapDifficulty = {
    hp: 5,
    cs: 5,
    od: 5,
    ar: 5,
    sliderMultiplier: 1.4,
    sliderTickRate: 1,
  };

  const timingPoints: TimingPoint[] = [];
  const hitObjects: HitObject[] = [];

  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('//')) {
      continue;
    }

    if (rawLine.startsWith('[') && rawLine.endsWith(']')) {
      currentSection = rawLine.slice(1, -1);
      continue;
    }

    if (currentSection === 'General') {
      const colonIdx = rawLine.indexOf(':');
      if (colonIdx !== -1) {
        const key = rawLine.slice(0, colonIdx).trim();
        const val = rawLine.slice(colonIdx + 1).trim();
        if (key === 'Mode') {
          metadata.mode = parseInt(val, 10) || 0;
        } else if (key === 'AudioFilename') {
          metadata.audioFilename = val;
        }
      }
    } else if (currentSection === 'Metadata') {
      const colonIdx = rawLine.indexOf(':');
      if (colonIdx !== -1) {
        const key = rawLine.slice(0, colonIdx).trim();
        const val = rawLine.slice(colonIdx + 1).trim();
        switch (key) {
          case 'Title':
            metadata.title = val;
            break;
          case 'TitleUnicode':
            metadata.titleUnicode = val;
            break;
          case 'Artist':
            metadata.artist = val;
            break;
          case 'ArtistUnicode':
            metadata.artistUnicode = val;
            break;
          case 'Creator':
            metadata.creator = val;
            break;
          case 'Version':
            metadata.version = val;
            break;
          case 'Source':
            metadata.source = val;
            break;
          case 'Tags':
            metadata.tags = val.split(/\s+/).filter(Boolean);
            break;
          case 'BeatmapID':
            metadata.beatmapId = parseInt(val, 10) || 0;
            break;
          case 'BeatmapSetID':
            metadata.beatmapSetId = parseInt(val, 10) || 0;
            break;
        }
      }
    } else if (currentSection === 'Difficulty') {
      const colonIdx = rawLine.indexOf(':');
      if (colonIdx !== -1) {
        const key = rawLine.slice(0, colonIdx).trim();
        const val = parseFloat(rawLine.slice(colonIdx + 1).trim());
        if (!isNaN(val)) {
          switch (key) {
            case 'HPDrainRate':
              difficulty.hp = val;
              break;
            case 'CircleSize':
              difficulty.cs = val;
              break;
            case 'OverallDifficulty':
              difficulty.od = val;
              break;
            case 'ApproachRate':
              difficulty.ar = val;
              break;
            case 'SliderMultiplier':
              difficulty.sliderMultiplier = val;
              break;
            case 'SliderTickRate':
              difficulty.sliderTickRate = val;
              break;
          }
        }
      }
    } else if (currentSection === 'TimingPoints') {
      const parts = rawLine.split(',');
      if (parts.length >= 2) {
        const time = parseFloat(parts[0]);
        const beatLength = parseFloat(parts[1]);
        const meter = parts[2] ? parseInt(parts[2], 10) : 4;
        const sampleSet = parts[3] ? parseInt(parts[3], 10) : 0;
        const sampleIndex = parts[4] ? parseInt(parts[4], 10) : 0;
        const volume = parts[5] ? parseInt(parts[5], 10) : 100;
        const uninherited = parts[6] ? parts[6].trim() === '1' : true;
        const effects = parts[7] ? parseInt(parts[7], 10) : 0;

        timingPoints.push({
          time,
          beatLength,
          meter,
          sampleSet,
          sampleIndex,
          volume,
          uninherited,
          effects,
        });
      }
    } else if (currentSection === 'HitObjects') {
      const parts = rawLine.split(',');
      if (parts.length >= 5) {
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        const time = parseFloat(parts[2]);
        const type = parseInt(parts[3], 10);
        const hitSound = parseInt(parts[4], 10);

        const isCircle = (type & 1) !== 0;
        const isSlider = (type & 2) !== 0;
        const isSpinner = (type & 8) !== 0;

        let endTime = time;
        let curveType: 'B' | 'C' | 'L' | 'P' | undefined;
        let curvePoints: CurvePoint[] | undefined;
        let repeats = 1;
        let pixelLength = 0;

        if (isSlider && parts.length >= 6) {
          const curveData = parts[5].split('|');
          const typeChar = curveData[0];
          if (['B', 'C', 'L', 'P'].includes(typeChar)) {
            curveType = typeChar as 'B' | 'C' | 'L' | 'P';
          } else {
            curveType = 'B';
          }

          curvePoints = [{ x, y }];
          for (let c = 1; c < curveData.length; c++) {
            const coord = curveData[c].split(':');
            if (coord.length === 2) {
              const cx = parseFloat(coord[0]);
              const cy = parseFloat(coord[1]);
              if (!isNaN(cx) && !isNaN(cy)) {
                curvePoints.push({ x: cx, y: cy });
              }
            }
          }

          if (parts.length >= 7) {
            repeats = parseInt(parts[6], 10) || 1;
          }
          if (parts.length >= 8) {
            pixelLength = parseFloat(parts[7]) || 0;
          }

          // Estimate slider duration based on timing points
          const activeTiming = getTimingPointAt(timingPoints, time);
          const activeInherited = getInheritedTimingPointAt(timingPoints, time);
          const beatLength = activeTiming ? activeTiming.beatLength : 500;
          const svMultiplier = activeInherited && activeInherited.beatLength < 0
            ? Math.max(0.1, Math.min(10, -100 / activeInherited.beatLength))
            : 1.0;

          const pixelsPerBeat = difficulty.sliderMultiplier * 100 * svMultiplier;
          const beats = pixelsPerBeat > 0 ? (pixelLength * repeats) / pixelsPerBeat : 1;
          const duration = beats * beatLength;
          endTime = time + Math.max(0, duration);
        } else if (isSpinner && parts.length >= 6) {
          endTime = parseFloat(parts[5]) || time;
        }

        hitObjects.push({
          x,
          y,
          time,
          type,
          hitSound,
          endTime,
          isCircle,
          isSlider,
          isSpinner,
          curveType,
          curvePoints,
          repeats,
          pixelLength,
        });
      }
    }
  }

  // Sort hit objects by time
  hitObjects.sort((a, b) => a.time - b.time);

  // Calculate BPM from first uninherited timing point
  let bpm = 120;
  const firstUninherited = timingPoints.find((tp) => tp.uninherited);
  if (firstUninherited && firstUninherited.beatLength > 0) {
    bpm = Math.round(60000 / firstUninherited.beatLength);
  }

  const durationMs = hitObjects.length > 0
    ? Math.max(...hitObjects.map((h) => h.endTime)) - Math.min(...hitObjects.map((h) => h.time))
    : 0;

  const starRating = metadata.starRating || 0;

  return {
    metadata,
    difficulty,
    timingPoints,
    hitObjects,
    rawText: content,
    durationMs,
    bpm,
    mode: metadata.mode || 0,
    starRating,
  };
}

function getTimingPointAt(timingPoints: TimingPoint[], time: number): TimingPoint | null {
  const uninherited = timingPoints.filter((tp) => tp.uninherited);
  let result: TimingPoint | null = null;
  for (const tp of uninherited) {
    if (tp.time <= time) {
      result = tp;
    } else {
      break;
    }
  }
  return result || uninherited[0] || null;
}

function getInheritedTimingPointAt(timingPoints: TimingPoint[], time: number): TimingPoint | null {
  let result: TimingPoint | null = null;
  for (const tp of timingPoints) {
    if (tp.time <= time) {
      result = tp;
    } else {
      break;
    }
  }
  return result;
}

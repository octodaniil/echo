import type { Settings } from './settings';

export interface StreamQuality {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Default ("auto") video bitrate, bits/s. */
  bitrate: number;
}

// Default bitrates for H.264 screen content; the server has plenty of upload.
export const STREAM_QUALITIES: StreamQuality[] = [
  { id: '720p30', label: '720p · 30', width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  { id: '1080p30', label: '1080p · 30', width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  { id: '1080p60', label: '1080p · 60', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
  { id: '1440p60', label: '1440p · 60', width: 2560, height: 1440, fps: 60, bitrate: 12_000_000 },
  { id: '2160p60', label: '4K · 60', width: 3840, height: 2160, fps: 60, bitrate: 25_000_000 },
];

export const BITRATE_MIN_MBPS = 1;
export const BITRATE_MAX_MBPS = 40;

export type StreamPriority = 'smooth' | 'sharp';

export const qualityById = (id: string) => STREAM_QUALITIES.find((q) => q.id === id) ?? STREAM_QUALITIES[2]!;

/** Everything the encoder needs, derived from the user's stream settings. */
export function streamParams(s: Settings) {
  const q = qualityById(s.streamQuality);
  const bitrate = s.streamBitrate != null ? s.streamBitrate * 1_000_000 : q.bitrate;
  return {
    q,
    bitrate,
    // When the encoder runs short: keep the frame rate (resolution may drop for a moment)
    // or keep the resolution (frames may drop).
    degradation: (s.streamPriority === 'smooth' ? 'maintain-framerate' : 'maintain-resolution') as RTCDegradationPreference,
    // Tells the encoder what it's dealing with: motion (games, video) vs. detail (text).
    hint: s.streamPriority === 'smooth' ? 'motion' : 'detail',
  };
}

export const mbps = (bps: number) => `${Math.round((bps / 1_000_000) * 10) / 10} Мбит/с`;

export const streamLabel = (q: StreamQuality, bitrate: number) => `${q.label} · ${mbps(bitrate)}`;

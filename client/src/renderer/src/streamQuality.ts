export interface StreamQuality {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Target video bitrate, bits/s. */
  bitrate: number;
}

// Bitrates for H.264 screen content; generous because the server has plenty of upload.
export const STREAM_QUALITIES: StreamQuality[] = [
  { id: '720p30', label: '720p · 30', width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  { id: '1080p30', label: '1080p · 30', width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  { id: '1080p60', label: '1080p · 60', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
  { id: '1440p60', label: '1440p · 60', width: 2560, height: 1440, fps: 60, bitrate: 12_000_000 },
  { id: '2160p60', label: '4K · 60', width: 3840, height: 2160, fps: 60, bitrate: 25_000_000 },
];

export const qualityById = (id: string) => STREAM_QUALITIES.find((q) => q.id === id) ?? STREAM_QUALITIES[2]!;

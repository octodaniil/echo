/**
 * Hardware H.264 for screen sharing.
 *
 * Chromium on Windows hands every H.264 profile *except* Constrained Baseline
 * (profile-level-id=42e01f) to the GPU encoder (NVENC / AMF / QuickSync); 42e01f goes to
 * software OpenH264. The LiveKit server supports only 42e01f and High (64001f) for H.264
 * and always prefers 42e01f in its answer.
 *
 * So when this machine can hardware-encode H.264 High, we strip 42e01f from the video
 * sections of our own *offers* (publishing side only). The server is then left with High,
 * which every Echo client (Chromium) decodes in hardware. Machines without a hardware
 * encoder keep the defaults.
 */

const CBP = /profile-level-id=42e01f/i;
const HIGH = /profile-level-id=64/i;

/** Removes H.264 Constrained Baseline (and its RTX) from video m-sections that also offer High. */
export function stripConstrainedBaseline(sdp: string): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  // Split into session part + media sections.
  const sections: string[][] = [[]];
  for (const l of lines) {
    if (l.startsWith('m=')) sections.push([]);
    sections[sections.length - 1]!.push(l);
  }

  const out = sections.map((sec) => {
    if (!sec[0]?.startsWith('m=video')) return sec;
    const fmtp = new Map<string, string>();
    for (const l of sec) {
      const m = /^a=fmtp:(\d+) (.*)$/.exec(l);
      if (m) fmtp.set(m[1]!, m[2]!);
    }
    const cbp = [...fmtp].filter(([, f]) => CBP.test(f)).map(([pt]) => pt);
    const hasHigh = [...fmtp.values()].some((f) => HIGH.test(f));
    if (cbp.length === 0 || !hasHigh) return sec;

    const drop = new Set(cbp);
    for (const [pt, f] of fmtp) {
      const apt = /(?:^|;)apt=(\d+)/.exec(f)?.[1];
      if (apt && drop.has(apt)) drop.add(pt); // RTX for a dropped codec
    }
    return sec
      .filter((l) => {
        const pt = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)[ ]/.exec(l)?.[1];
        return !pt || !drop.has(pt);
      })
      .map((l, i) => {
        if (i !== 0) return l;
        const [m, port, proto, ...pts] = l.split(' ');
        return [m, port, proto, ...pts.filter((p) => !drop.has(p))].join(' ');
      });
  });
  return out.flat().join(eol);
}

export let hardwareH264 = false;

export async function installCodecPreferences(): Promise<void> {
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: 'webrtc',
      video: {
        contentType: 'video/H264; profile-level-id=64001f; packetization-mode=1',
        width: 1920,
        height: 1080,
        framerate: 60,
        bitrate: 8_000_000,
      },
    });
    hardwareH264 = info.supported && info.powerEfficient;
  } catch {
    hardwareH264 = false;
  }
  if (!hardwareH264) return;

  const createOffer = RTCPeerConnection.prototype.createOffer as (
    this: RTCPeerConnection,
    options?: RTCOfferOptions,
  ) => Promise<RTCSessionDescriptionInit>;
  RTCPeerConnection.prototype.createOffer = async function (this: RTCPeerConnection, options?: RTCOfferOptions) {
    const offer = await createOffer.call(this, options);
    return offer.sdp ? { type: offer.type, sdp: stripConstrainedBaseline(offer.sdp) } : offer;
  } as typeof RTCPeerConnection.prototype.createOffer;
}

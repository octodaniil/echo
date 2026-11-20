import {
  type ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type TrackPublication,
} from 'livekit-client';
import { MicPipeline } from './mic';
import { play } from './sounds';
import { settings, type Settings } from './settings';
import { streamLabel, streamParams } from './streamQuality';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface VoiceParticipant {
  id: string;
  nickname: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  streaming: boolean;
  /** When they joined this channel (ms since epoch). */
  joinedAt: number;
  /** Ids of people watching this person's stream. */
  viewers: string[];
  /** Their noise suppression mode (shared so friends can tell why someone is noisy). */
  ns: string | null;
  /** LiveKit's estimate of their connection (packet loss / jitter show up here). */
  quality: ConnectionQualityLevel;
}

export interface OutboundStats {
  width: number | null;
  height: number | null;
  fps: number | null;
  mbps: number | null;
  /** Why WebRTC is holding quality back: bandwidth / cpu / none. */
  limitation: string | null;
  /** Nobody is watching: LiveKit pauses encoding. */
  paused: boolean;
}

export type ConnectionQualityLevel = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export interface ConnectionStats {
  /** Round trip to the media server, ms. */
  rttMs: number | null;
  /** Share of our audio packets lost on the way (from server reports), %. */
  lossPct: number | null;
  /** udp / tcp, and whether a relay is used. */
  transport: string | null;
}

export interface SharingInfo {
  sourceName: string;
  quality: string;
  withAudio: boolean;
}

export interface VoiceState {
  status: VoiceStatus;
  channelId: number | null;
  micMuted: boolean;
  deafened: boolean;
  participants: VoiceParticipant[];
  /** Our own stream, if we are sharing. */
  sharing: SharingInfo | null;
  /** Whose stream we are watching. */
  watching: string | null;
  /** LiveKit's estimate of our connection. */
  quality: ConnectionQualityLevel;
  error: string | null;
}

const initial: VoiceState = {
  status: 'idle',
  channelId: null,
  micMuted: false,
  deafened: false,
  participants: [],
  sharing: null,
  watching: null,
  quality: 'unknown',
  error: null,
};

/** Level of received voice (dBFS) above which a remote user counts as speaking. */
const REMOTE_SPEAKING_DB = -55;
const SPEAKING_HOLD_MS = 250;

/** Measures the loudness of a received voice track. */
interface Meter {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
}

const isStreamSource = (s: Track.Source) => s === Track.Source.ScreenShare || s === Track.Source.ScreenShareAudio;

/**
 * One voice connection at a time, Discord-style: joining another channel leaves the current one.
 * UI subscribes to state changes; all LiveKit and audio details stay in here.
 */
class VoiceClient {
  private room: Room | null = null;
  private micTrack: LocalAudioTrack | null = null;
  private pipeline: MicPipeline | null = null;
  private pipelineStarting: Promise<MicPipeline> | null = null;
  /** Things besides a call that need the mic open (e.g. the settings screen). */
  private previewUsers = 0;
  private speakingTimer: number | undefined;
  private remoteSpeakingUntil = new Map<string, number>();
  /** Analysers on friends' voices; one shared AudioContext only while in a call. */
  private meterCtx: AudioContext | null = null;
  private meters = new Map<string, Meter>();
  private meterBuf = new Float32Array(512);
  private screenStream: MediaStream | null = null;
  private screenPubs: LocalTrackPublication[] = [];
  /** Someone whose stream we want to open as soon as it shows up (double-click from the list). */
  private pendingWatch: string | null = null;

  private state: VoiceState = { ...initial };
  private listeners = new Set<(s: VoiceState) => void>();
  /** Mic state to restore when un-deafening. */
  private micMutedBeforeDeafen = false;

  constructor() {
    settings.subscribe((next, prev) => void this.onSettings(next, prev));
  }

  get snapshot() {
    return this.state;
  }

  subscribe(fn: (s: VoiceState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<VoiceState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  // ---------- microphone pipeline ----------

  private async ensurePipeline(): Promise<MicPipeline> {
    if (this.pipeline) return this.pipeline;
    this.pipelineStarting ??= (async () => {
      const p = new MicPipeline();
      try {
        await p.start(settings.get());
      } catch (err) {
        await p.destroy();
        throw err;
      }
      p.onGateChange(() => this.syncParticipants());
      // Tell the user when Echo had to bring the mic back by itself (so we learn what happens).
      p.onRecover((reason) => {
        if (this.room) this.set({ error: `Микрофон: ${reason}. Echo сам всё починил — говори дальше` });
      });
      this.pipeline = p;
      return p;
    })().finally(() => (this.pipelineStarting = null));
    return this.pipelineStarting;
  }

  private async releasePipelineIfUnused() {
    if (this.room || this.previewUsers > 0 || !this.pipeline) return;
    const p = this.pipeline;
    this.pipeline = null;
    await p.destroy();
  }

  /** Opens the mic for the settings screen. Call the returned function when done. */
  async acquirePreview(): Promise<{ pipeline: MicPipeline; release: () => void }> {
    this.previewUsers++;
    try {
      const pipeline = await this.ensurePipeline();
      let released = false;
      return {
        pipeline,
        release: () => {
          if (released) return;
          released = true;
          this.previewUsers--;
          void this.releasePipelineIfUnused();
        },
      };
    } catch (err) {
      this.previewUsers--;
      throw err;
    }
  }

  private async onSettings(next: Settings, prev: Settings) {
    if (this.room && next.noiseSuppression !== prev.noiseSuppression) {
      void this.room.localParticipant.setAttributes({ ns: next.noiseSuppression }).catch(() => {});
    }
    try {
      await this.pipeline?.apply(next);
    } catch (err) {
      this.set({ error: errorText(err) });
    }
    if (this.room && next.outputDeviceId !== prev.outputDeviceId) {
      await this.room.switchActiveDevice('audiooutput', next.outputDeviceId).catch(() => {});
    }
    if (
      this.state.sharing &&
      (next.streamQuality !== prev.streamQuality ||
        next.streamBitrate !== prev.streamBitrate ||
        next.streamPriority !== prev.streamPriority)
    ) {
      await this.applyStreamSettings();
    }
    if (
      next.outputVolume !== prev.outputVolume ||
      next.userVolumes !== prev.userVolumes ||
      next.streamVolumes !== prev.streamVolumes
    ) {
      this.applyVolumes();
    }
  }

  private volumeFor(id: string, source: Track.Source): number {
    if (this.state.deafened) return 0;
    const s = settings.get();
    const per = source === Track.Source.ScreenShareAudio ? s.streamVolumes[id] : s.userVolumes[id];
    return s.outputVolume * (per ?? 1);
  }

  private applyVolumes() {
    this.room?.remoteParticipants.forEach((p) => {
      p.setVolume(this.volumeFor(p.identity, Track.Source.Microphone), Track.Source.Microphone);
      p.setVolume(this.volumeFor(p.identity, Track.Source.ScreenShareAudio), Track.Source.ScreenShareAudio);
    });
  }

  setUserVolume(id: string, volume: number) {
    settings.update({ userVolumes: { ...settings.get().userVolumes, [id]: volume } });
  }

  setStreamVolume(id: string, volume: number) {
    settings.update({ streamVolumes: { ...settings.get().streamVolumes, [id]: volume } });
  }

  // ---------- participants & speaking ----------

  private syncParticipants() {
    const room = this.room;
    if (!room) return;
    const local = room.localParticipant;
    const now = performance.now();
    const all: Participant[] = [local, ...room.remoteParticipants.values()];
    const watchingOf = (p: Participant) => (p === local ? this.state.watching : p.attributes?.watching) || null;
    const participants = all
      .map((p) => {
        const isLocal = p === local;
        return {
          id: p.identity,
          nickname: p.name || p.identity,
          isLocal,
          speaking: isLocal
            ? !this.state.micMuted && (this.pipeline?.gateOpen ?? false)
            : (this.remoteSpeakingUntil.get(p.identity) ?? 0) > now,
          micMuted: isLocal ? this.state.micMuted : !p.isMicrophoneEnabled,
          streaming: !!p.getTrackPublication(Track.Source.ScreenShare),
          joinedAt: p.joinedAt?.getTime() ?? Date.now(),
          viewers: all.filter((q) => q !== p && watchingOf(q) === p.identity).map((q) => q.identity),
          ns: isLocal ? settings.get().noiseSuppression : (p.attributes?.ns ?? null),
          quality: (p.connectionQuality ?? 'unknown') as ConnectionQualityLevel,
        };
      })
      .sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.nickname.localeCompare(b.nickname));

    // Stop "watching" a stream that ended.
    const watching =
      this.state.watching && participants.some((p) => p.id === this.state.watching && p.streaming)
        ? this.state.watching
        : null;

    // Skip re-rendering when nothing visible changed (this runs ~16x a second).
    const prev = this.state.participants;
    const same =
      watching === this.state.watching &&
      prev.length === participants.length &&
      prev.every((p, i) => {
        const n = participants[i]!;
        return (
          p.id === n.id &&
          p.speaking === n.speaking &&
          p.micMuted === n.micMuted &&
          p.nickname === n.nickname &&
          p.streaming === n.streaming &&
          p.viewers.join() === n.viewers.join() &&
          p.ns === n.ns &&
          p.quality === n.quality
        );
      });
    if (!same) this.set({ participants, watching });

    if (this.pendingWatch && participants.some((p) => p.id === this.pendingWatch && p.streaming)) {
      const id = this.pendingWatch;
      this.pendingWatch = null;
      this.watch(id);
    }
  }

  private addMeter(identity: string, track: MediaStreamTrack) {
    this.removeMeter(identity);
    this.meterCtx ??= new AudioContext({ latencyHint: 'playback' });
    const source = this.meterCtx.createMediaStreamSource(new MediaStream([track]));
    const analyser = this.meterCtx.createAnalyser();
    analyser.fftSize = 512;
    // Not connected to the speakers: an analyser is pulled on its own; playback stays LiveKit's.
    source.connect(analyser);
    this.meters.set(identity, { source, analyser });
  }

  private removeMeter(identity: string) {
    const m = this.meters.get(identity);
    if (!m) return;
    m.source.disconnect();
    this.meters.delete(identity);
  }

  /**
   * Remote speaking indicator from the voice we actually receive (~60 ms reaction).
   * The LiveKit server's own active-speaker flag is a fallback.
   * (RTP audio-level headers looked cheaper, but the server doesn't forward them.)
   */
  private pollRemoteSpeaking() {
    const room = this.room;
    if (!room) return;
    const now = performance.now();
    for (const p of room.remoteParticipants.values()) {
      const pub = p.getTrackPublication(Track.Source.Microphone);
      if (!pub || pub.isMuted) continue;
      let loud = p.isSpeaking;
      const m = this.meters.get(p.identity);
      if (m) {
        m.analyser.getFloatTimeDomainData(this.meterBuf);
        let sum = 0;
        for (const v of this.meterBuf) sum += v * v;
        const db = 10 * Math.log10(sum / this.meterBuf.length + 1e-12);
        loud ||= db > REMOTE_SPEAKING_DB;
      }
      if (loud) this.remoteSpeakingUntil.set(p.identity, now + SPEAKING_HOLD_MS);
    }
    this.syncParticipants();
  }

  /** Voice is always received; streams only while someone is watching them. */
  private autoSubscribe(pub: RemoteTrackPublication) {
    if (pub.source === Track.Source.Microphone) pub.setSubscribed(true);
  }

  // ---------- connection ----------

  async join(channelId: number, force = false) {
    if (!force && this.state.channelId === channelId && this.state.status !== 'idle') return;
    // Show the target channel right away (like Discord): we appear there as "connecting"
    // while the old room closes. The mic pipeline is kept, so the switch is fast.
    this.set({ status: 'connecting', channelId, error: null, participants: [], watching: null, sharing: null });
    await this.leave(true);
    this.set({ status: 'connecting', channelId, error: null });

    const s = settings.get();
    const room = new Room({
      // Off on purpose: streams are only subscribed while someone watches them anyway, and
      // adaptive stream would pause video shown in a pop-out window (another document).
      adaptiveStream: false,
      // Stop sending video layers nobody is watching.
      dynacast: true,
      // Lets per-user volume go above 100% and keeps playback in one AudioContext.
      webAudioMix: true,
      audioOutput: { deviceId: s.outputDeviceId },
      // Our mic track belongs to MicPipeline; LiveKit must not stop it.
      stopLocalTrackOnUnpublish: false,
    });
    this.room = room;
    let everConnected = false;

    const sync = () => this.room === room && this.syncParticipants();
    room
      .on(RoomEvent.ParticipantConnected, () => {
        void play('userJoin');
        sync();
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        this.remoteSpeakingUntil.delete(p.identity);
        this.removeMeter(p.identity);
        void play('userLeave');
        sync();
      })
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication) => {
        this.autoSubscribe(pub);
        if (pub.source === Track.Source.ScreenShare) void play('streamStart');
        sync();
      })
      .on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, p: Participant) => {
        if (this.room === room && p === room.localParticipant) this.set({ quality: quality as ConnectionQualityLevel });
        sync();
      })
      .on(RoomEvent.TrackUnpublished, sync)
      .on(RoomEvent.ParticipantAttributesChanged, (changed: Record<string, string>, p: Participant) => {
        if (p !== room.localParticipant && 'watching' in changed && changed.watching === room.localParticipant.identity) {
          void play('viewerJoin');
        }
        sync();
      })
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.ParticipantNameChanged, sync)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.dataset.echoAudio = participant.identity;
          document.body.appendChild(el);
          participant.setVolume(this.volumeFor(participant.identity, pub.source), pub.source as Track.Source.Microphone);
          if (pub.source === Track.Source.Microphone) this.addMeter(participant.identity, track.mediaStreamTrack);
        }
        sync();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove());
        if (pub.source === Track.Source.Microphone) this.removeMeter(participant.identity);
        sync();
      })
      .on(RoomEvent.LocalTrackUnpublished, sync)
      .on(RoomEvent.ConnectionStateChanged, (cs: ConnectionState) => {
        if (this.room !== room) return;
        if (cs === ConnectionState.Reconnecting || cs === ConnectionState.SignalReconnecting) {
          this.set({ status: 'reconnecting' });
        } else if (cs === ConnectionState.Connected) {
          this.set({ status: 'connected' });
        }
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (this.room !== room) return;
        if (everConnected && reason !== DisconnectReason.CLIENT_INITIATED) void play('disconnected');
        const error = !everConnected
          ? 'Не удалось подключиться к голосовому серверу'
          : reason === DisconnectReason.PARTICIPANT_REMOVED
            ? 'Тебя отключили от канала'
            : reason === DisconnectReason.ROOM_DELETED
              ? 'Канал удалён'
              : reason === DisconnectReason.CLIENT_INITIATED
                ? null
                : 'Соединение потеряно';
        void this.teardown(error);
      });

    try {
      const [{ url, token }, pipeline] = await Promise.all([window.echo.connect(channelId), this.ensurePipeline()]);
      if (this.room !== room) return; // user switched channel meanwhile
      await room.connect(url, token, { autoSubscribe: false });
      if (this.room !== room) return;
      everConnected = true;
      void room.localParticipant.setAttributes({ ns: s.noiseSuppression }).catch(() => {});
      for (const p of room.remoteParticipants.values()) p.trackPublications.forEach((pub) => this.autoSubscribe(pub));

      const micTrack = new LocalAudioTrack(pipeline.track, undefined, true);
      this.micTrack = micTrack;
      await room.localParticipant.publishTrack(micTrack, {
        source: Track.Source.Microphone,
        // Don't send packets during silence.
        dtx: true,
        // Redundant audio: survives packet loss without retransmit delays.
        red: true,
        audioPreset: { maxBitrate: 48_000 },
      });
      if (this.state.micMuted || this.state.deafened || this.micTesting) await micTrack.mute();

      this.set({ status: 'connected' });
      if (!force) void play('join');
      this.speakingTimer = window.setInterval(() => this.pollRemoteSpeaking(), 60);
      this.syncParticipants();
    } catch (err) {
      if (this.room !== room) return;
      await room.disconnect();
      await this.teardown(errorText(err));
    }
  }

  /** @param switching true when leaving only to join another channel (no "leave" sound). */
  /** After a moderator's mute ends: publish our mic again (the server dropped it). */
  async republishMic() {
    const room = this.room;
    const track = this.micTrack;
    if (!room || !track || this.state.status !== 'connected') return;
    if ([...room.localParticipant.audioTrackPublications.values()].some((p) => p.track === track)) return;
    await room.localParticipant
      .publishTrack(track, { source: Track.Source.Microphone, dtx: true, red: true, audioPreset: { maxBitrate: 48_000 } })
      .catch((err) => console.warn('[voice] republish mic', err));
    if (this.state.micMuted || this.state.deafened || this.micTesting) await track.mute();
  }

  async leave(switching = false) {
    const room = this.room;
    if (!room) return;
    if (!switching) {
      this.pendingWatch = null;
      void play('leave');
    }
    await this.teardown(null, switching);
    await room.disconnect();
  }

  private async teardown(error: string | null, switching = false) {
    clearInterval(this.speakingTimer);
    this.room = null;
    this.micTrack = null;
    this.stopScreenCapture();
    this.remoteSpeakingUntil.clear();
    for (const id of [...this.meters.keys()]) this.removeMeter(id);
    void this.meterCtx?.close();
    this.meterCtx = null;
    document.querySelectorAll('[data-echo-audio]').forEach((el) => el.remove());
    if (switching) {
      // Keep showing the channel we are moving to; keep the mic pipeline for the new room.
      this.set({ ...initial, micMuted: this.state.micMuted, deafened: this.state.deafened, status: 'connecting', channelId: this.state.channelId });
      return;
    }
    this.set({ ...initial, micMuted: this.state.micMuted, deafened: this.state.deafened, error });
    await this.releasePipelineIfUnused();
  }

  // ---------- screen sharing ----------

  private publisherPc(): RTCPeerConnection | undefined {
    return (this.room as unknown as { engine?: { pcManager?: { publisher?: { pc?: RTCPeerConnection } } } } | null)?.engine
      ?.pcManager?.publisher?.pc;
  }

  /**
   * LiveKit never removes a stopped stream from the connection: each stop leaves its video
   * and audio sections behind as "inactive", and every renegotiation has to carry all of
   * them. After ~100 restarts starting a stream crawled. We count the dead sections and,
   * past a limit, quietly reconnect to the same channel to start from a clean connection.
   */
  private deadSections(): number {
    const pc = this.publisherPc();
    if (!pc) return 0;
    return pc.getTransceivers().filter((t) => !t.sender.track && (t.direction === 'inactive' || t.currentDirection === 'inactive'))
      .length;
  }

  async startScreenShare(source: { id: string; name: string }, withAudio: boolean) {
    if (!this.room || this.state.status !== 'connected') throw new Error('Сначала зайди в голосовой канал');
    if (this.state.sharing) await this.stopScreenShare();
    if (this.deadSections() >= 16 && this.state.channelId !== null) {
      console.info('[stream] clean reconnect before streaming, dead sections:', this.deadSections());
      await this.join(this.state.channelId, true);
    }
    const room = this.room;
    if (!room || this.state.status !== 'connected') throw new Error('Не удалось переподключиться к каналу, попробуй ещё раз');

    const { q, bitrate, degradation, hint } = streamParams(settings.get());
    await window.echo.selectScreenSource(source.id, withAudio);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: q.width }, height: { max: q.height }, frameRate: { ideal: q.fps, max: q.fps } },
      audio: withAudio
        ? ({
            // Leave Echo's own playback (friends' voices) out of the shared system sound.
            restrictOwnAudio: true,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as MediaTrackConstraints)
        : false,
    });
    if (this.room !== room) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.screenStream = stream;

    const video = stream.getVideoTracks()[0]!;
    video.contentHint = hint;
    // The shared window was closed or the screen went away.
    video.addEventListener('ended', () => void this.stopScreenShare());

    try {
      this.screenPubs.push(
        await room.localParticipant.publishTrack(video, {
          source: Track.Source.ScreenShare,
          // H.264 is hardware-encoded (and decoded) on practically every GPU.
          videoCodec: 'h264',
          // One layer: no extra encoder work for a handful of friends.
          simulcast: false,
          // For screen shares LiveKit reads screenShareEncoding (videoEncoding is ignored and
          // it falls back to its 1080p·15 fps preset — streams looked choppy because of that).
          screenShareEncoding: { maxBitrate: bitrate, maxFramerate: q.fps, priority: 'high' },
          degradationPreference: degradation,
        }),
      );
      const audio = stream.getAudioTracks()[0];
      if (audio) {
        this.screenPubs.push(
          await room.localParticipant.publishTrack(audio, {
            source: Track.Source.ScreenShareAudio,
            dtx: false,
            red: false,
            forceStereo: true,
            audioPreset: { maxBitrate: 128_000 },
          }),
        );
      }
    } catch (err) {
      await this.stopScreenShare();
      throw err;
    }
    this.set({
      sharing: { sourceName: source.name, quality: streamLabel(q, bitrate), withAudio: !!stream.getAudioTracks()[0] },
    });
    void play('streamStart');
    this.syncParticipants();
  }

  async stopScreenShare() {
    const room = this.room;
    const pubs = this.screenPubs;
    if (pubs.length > 0) void play('streamStop');
    this.screenPubs = [];
    if (room) {
      for (const pub of pubs) if (pub.track) await room.localParticipant.unpublishTrack(pub.track, true).catch(() => {});
    }
    this.stopScreenCapture();
    this.set({ sharing: null });
    this.syncParticipants();
  }

  /**
   * Applies changed quality / bitrate / priority to the running stream without restarting it:
   * capture constraints for resolution and fps, sender parameters for the encoder.
   */
  private async applyStreamSettings() {
    const pub = this.screenPubs.find((x) => x.source === Track.Source.ScreenShare);
    const track = pub?.track;
    if (!track || !this.state.sharing) return;
    const { q, bitrate, degradation, hint } = streamParams(settings.get());

    const mst = track.mediaStreamTrack;
    mst.contentHint = hint;
    await mst
      .applyConstraints({ width: { max: q.width }, height: { max: q.height }, frameRate: { ideal: q.fps, max: q.fps } })
      .catch((err) => console.warn('[stream] applyConstraints', err));

    const sender = track.sender;
    if (sender) {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
      params.degradationPreference = degradation;
      for (const e of params.encodings) {
        e.maxBitrate = bitrate;
        e.maxFramerate = q.fps;
      }
      await sender.setParameters(params).catch((err) => console.warn('[stream] setParameters', err));
    }
    // LiveKit keeps its own copy of the encodings (dynacast re-applies them).
    const own = (track as unknown as { encodings?: RTCRtpEncodingParameters[] }).encodings;
    if (Array.isArray(own)) for (const e of own) Object.assign(e, { maxBitrate: bitrate, maxFramerate: q.fps });

    this.set({ sharing: { ...this.state.sharing, quality: streamLabel(q, bitrate) } });
  }

  private stopScreenCapture() {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenPubs = [];
  }

  /** Our own captured screen, for the streamer's preview window. */
  get localScreenTrack(): MediaStreamTrack | null {
    return this.screenPubs.find((p) => p.source === Track.Source.ScreenShare)?.track?.mediaStreamTrack ?? null;
  }

  private lastOutbound: { bytes: number; frames: number; t: number } | null = null;

  /** What actually leaves the encoder right now (for the preview overlay). */
  async outboundStats(): Promise<OutboundStats | null> {
    const track = this.screenPubs.find((p) => p.source === Track.Source.ScreenShare)?.track;
    if (!track) return null;
    const report = await track.getRTCStatsReport();
    let o: Record<string, any> | undefined;
    report?.forEach((s) => {
      if (s.type === 'outbound-rtp' && s.kind === 'video') o = s;
    });
    const paused = track.sender?.getParameters().encodings.every((e) => e.active === false) ?? false;
    if (!o) return { width: null, height: null, fps: null, mbps: null, limitation: null, paused };
    const now = { bytes: o.bytesSent as number, frames: o.framesEncoded as number, t: o.timestamp as number };
    const prev = this.lastOutbound;
    this.lastOutbound = now;
    const dt = prev ? (now.t - prev.t) / 1000 : 0;
    return {
      width: o.frameWidth ?? null,
      height: o.frameHeight ?? null,
      fps: prev && dt > 0 ? Math.round((now.frames - prev.frames) / dt) : (o.framesPerSecond ?? null),
      mbps: prev && dt > 0 ? Math.round(((now.bytes - prev.bytes) * 8) / dt / 100_000) / 10 : null,
      limitation: o.qualityLimitationReason ?? null,
      paused,
    };
  }

  /** Diagnostics: capture settings and live encoder stats of our own stream. */
  async streamDiagnostics() {
    const video = this.screenPubs.find((p) => p.source === Track.Source.ScreenShare)?.track;
    const report = video ? await video.getRTCStatsReport() : undefined;
    const outbound: Record<string, unknown>[] = [];
    report?.forEach((s) => {
      if (s.type === 'outbound-rtp' && s.kind === 'video') {
        outbound.push({
          encoder: s.encoderImplementation,
          powerEfficient: s.powerEfficientEncoder,
          fps: s.framesPerSecond,
          width: s.frameWidth,
          height: s.frameHeight,
          bytesSent: s.bytesSent,
          qualityLimitation: s.qualityLimitationReason,
        });
      }
      if (s.type === 'codec' && String(s.mimeType).startsWith('video')) outbound.push({ codec: s.mimeType });
    });
    return {
      videoSettings: this.screenStream?.getVideoTracks()[0]?.getSettings() ?? null,
      audioSettings: this.screenStream?.getAudioTracks()[0]?.getSettings() ?? null,
      outbound,
    };
  }

  private streamPubs(participantId: string): TrackPublication[] {
    const p = this.room?.remoteParticipants.get(participantId);
    if (!p) return [];
    return [...p.trackPublications.values()].filter((pub) => isStreamSource(pub.source));
  }

  watch(participantId: string) {
    if (this.state.watching === participantId) return;
    if (this.state.watching) this.unwatch(true);
    for (const pub of this.streamPubs(participantId)) (pub as RemoteTrackPublication).setSubscribed(true);
    this.set({ watching: participantId });
    void play('watchStart');
    this.announceWatching(participantId);
    this.syncParticipants();
  }

  /** Tell everyone whose stream we watch, so streamers see their viewer count. */
  private announceWatching(id: string | null) {
    void this.room?.localParticipant.setAttributes({ watching: id ?? '' }).catch(() => {});
  }

  /** Double-click on a streamer in the list: join their channel if needed, then open the stream. */
  async watchUser(channelId: number, userId: string) {
    if (this.state.channelId === channelId && this.state.status === 'connected') {
      this.watch(userId);
      return;
    }
    this.pendingWatch = userId;
    await this.join(channelId);
    this.syncParticipants();
  }

  /** Ping, loss and transport of the media connection (for the connection popover). */
  async connectionStats(): Promise<ConnectionStats> {
    const engine = (this.room as unknown as { engine?: { pcManager?: { publisher?: { pc?: RTCPeerConnection } } } } | null)
      ?.engine;
    const pc = engine?.pcManager?.publisher?.pc;
    const result: ConnectionStats = { rttMs: null, lossPct: null, transport: null };
    if (!pc) return result;
    const report = await pc.getStats();
    let pairId: string | undefined;
    report.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
    report.forEach((s) => {
      const isPair = s.type === 'candidate-pair' && (pairId ? s.id === pairId : s.nominated && s.state === 'succeeded');
      if (isPair) {
        if (typeof s.currentRoundTripTime === 'number') result.rttMs = Math.round(s.currentRoundTripTime * 1000);
        const local = report.get(s.localCandidateId);
        if (local) result.transport = `${String(local.protocol).toUpperCase()}${local.candidateType === 'relay' ? ' (relay)' : ''}`;
      }
      if (s.type === 'remote-inbound-rtp' && s.kind === 'audio' && typeof s.fractionLost === 'number') {
        result.lossPct = Math.round(s.fractionLost * 1000) / 10;
      }
    });
    return result;
  }

  unwatch(switching = false) {
    const id = this.state.watching;
    if (!id) return;
    for (const pub of this.streamPubs(id)) (pub as RemoteTrackPublication).setSubscribed(false);
    this.set({ watching: null });
    if (!switching) {
      this.announceWatching(null);
      this.syncParticipants();
    }
  }

  /** Calls back with someone's stream track whenever it (re)appears. Returns an unsubscribe. */
  watchStreamTrack(participantId: string, cb: (track: MediaStreamTrack | null) => void): () => void {
    const room = this.room;
    if (!room) return () => {};
    const emit = () => {
      const pub = room.remoteParticipants.get(participantId)?.getTrackPublication(Track.Source.ScreenShare);
      cb((pub?.track as RemoteTrack | undefined)?.mediaStreamTrack ?? null);
    };
    emit();
    room.on(RoomEvent.TrackSubscribed, emit).on(RoomEvent.TrackUnsubscribed, emit);
    return () => {
      room.off(RoomEvent.TrackSubscribed, emit).off(RoomEvent.TrackUnsubscribed, emit);
    };
  }

  private micTesting = false;

  /** Mic check in settings: you hear yourself, the channel doesn't hear you meanwhile. */
  async setMicTest(on: boolean) {
    if (this.micTesting === on) return;
    this.micTesting = on;
    if (!this.micTrack) return;
    if (on) await this.micTrack.mute();
    else if (!this.state.micMuted && !this.state.deafened) await this.micTrack.unmute();
  }

  /** Attaches someone's stream video to an element. Returns a detach function. */
  attachStream(participantId: string, el: HTMLVideoElement, onReady: () => void): () => void {
    const room = this.room;
    if (!room) return () => {};
    let attached: RemoteTrack | null = null;
    const tryAttach = () => {
      const pub = room.remoteParticipants.get(participantId)?.getTrackPublication(Track.Source.ScreenShare);
      const track = pub?.track as RemoteTrack | undefined;
      if (track && track !== attached) {
        attached?.detach(el);
        track.attach(el);
        attached = track;
        onReady();
      }
    };
    tryAttach();
    room.on(RoomEvent.TrackSubscribed, tryAttach);
    return () => {
      room.off(RoomEvent.TrackSubscribed, tryAttach);
      attached?.detach(el);
    };
  }

  // ---------- mute / deafen ----------

  async toggleMic() {
    // Unmuting while deafened also un-deafens, like Discord.
    if (this.state.deafened) return this.toggleDeafen();
    await this.setMic(!this.state.micMuted);
  }

  private async setMic(muted: boolean, silent = false) {
    if (!silent && muted !== this.state.micMuted) void play(muted ? 'mute' : 'unmute');
    this.set({ micMuted: muted });
    if (this.micTrack) await (muted || this.micTesting ? this.micTrack.mute() : this.micTrack.unmute());
    this.syncParticipants();
  }

  async toggleDeafen() {
    const deafened = !this.state.deafened;
    void play(deafened ? 'deafen' : 'undeafen');
    if (deafened) {
      this.micMutedBeforeDeafen = this.state.micMuted;
      this.set({ deafened });
      this.applyVolumes();
      await this.setMic(true, true);
    } else {
      this.set({ deafened });
      this.applyVolumes();
      await this.setMic(this.micMutedBeforeDeafen, true);
    }
  }

  clearError() {
    this.set({ error: null });
  }
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/permission|NotAllowed/i.test(msg)) return 'Нет доступа к микрофону';
  if (/NotFound|Requested device not found/i.test(msg)) return 'Микрофон не найден';
  return msg || 'Не удалось подключиться';
}

export const voice = new VoiceClient();

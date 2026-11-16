import {
  ConnectionState,
  DisconnectReason,
  type Participant,
  type RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface VoiceParticipant {
  id: string;
  nickname: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
}

export interface VoiceState {
  status: VoiceStatus;
  channelId: number | null;
  micMuted: boolean;
  deafened: boolean;
  participants: VoiceParticipant[];
  error: string | null;
}

const initial: VoiceState = {
  status: 'idle',
  channelId: null,
  micMuted: false,
  deafened: false,
  participants: [],
  error: null,
};

/**
 * One voice connection at a time, Discord-style: joining another channel leaves the current one.
 * UI subscribes to state changes; all LiveKit details stay in here.
 */
class VoiceClient {
  private room: Room | null = null;
  private state: VoiceState = { ...initial };
  private listeners = new Set<(s: VoiceState) => void>();
  /** Mic state to restore when un-deafening. */
  private micMutedBeforeDeafen = false;

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

  private syncParticipants() {
    const room = this.room;
    if (!room) return this.set({ participants: [] });
    const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    this.set({
      participants: all
        .map((p) => ({
          id: p.identity,
          nickname: p.name || p.identity,
          isLocal: p === room.localParticipant,
          speaking: p.isSpeaking,
          micMuted: !p.isMicrophoneEnabled,
        }))
        .sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.nickname.localeCompare(b.nickname)),
    });
  }

  async join(channelId: number) {
    if (this.state.channelId === channelId && this.state.status !== 'idle') return;
    await this.leave();
    this.set({ status: 'connecting', channelId, error: null });

    const room = new Room({
      // Only receive video in the resolution it is actually shown at.
      adaptiveStream: true,
      // Stop sending video layers nobody is watching.
      dynacast: true,
      // Lets per-user volume go above 100% and keeps playback in one AudioContext.
      webAudioMix: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      publishDefaults: {
        // Don't send packets during silence.
        dtx: true,
        // Redundant audio encoding: survives packet loss without retransmit delays.
        red: true,
        audioPreset: { maxBitrate: 48_000 },
      },
    });
    this.room = room;
    let everConnected = false;

    const sync = () => this.room === room && this.syncParticipants();
    room
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.ActiveSpeakersChanged, sync)
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.LocalTrackPublished, sync)
      .on(RoomEvent.LocalTrackUnpublished, sync)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.dataset.echoAudio = participant.identity;
          document.body.appendChild(el);
          if (this.state.deafened) participant.setVolume(0);
        }
        sync();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        sync();
      })
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
        this.cleanup();
        const error = !everConnected
          ? 'Не удалось подключиться к голосовому серверу'
          : reason === DisconnectReason.PARTICIPANT_REMOVED
            ? 'Тебя отключили от канала'
            : reason === DisconnectReason.ROOM_DELETED
              ? 'Канал удалён'
              : reason === DisconnectReason.CLIENT_INITIATED
                ? null
                : 'Соединение потеряно';
        this.set({ ...initial, micMuted: this.state.micMuted, deafened: this.state.deafened, error });
      });

    try {
      const { url, token } = await window.echo.connect(channelId);
      if (this.room !== room) return; // user switched channel meanwhile
      await room.connect(url, token);
      if (this.room !== room) return;
      everConnected = true;
      this.set({ status: 'connected' });
      await room.localParticipant.setMicrophoneEnabled(!this.state.micMuted && !this.state.deafened);
      this.syncParticipants();
    } catch (err) {
      if (this.room !== room) return;
      this.cleanup();
      await room.disconnect();
      this.set({ ...initial, micMuted: this.state.micMuted, deafened: this.state.deafened, error: errorText(err) });
    }
  }

  async leave() {
    const room = this.room;
    if (!room) return;
    this.cleanup();
    await room.disconnect();
    this.set({ ...initial, micMuted: this.state.micMuted, deafened: this.state.deafened });
  }

  private cleanup() {
    this.room = null;
    document.querySelectorAll('[data-echo-audio]').forEach((el) => el.remove());
  }

  async toggleMic() {
    // Unmuting while deafened also un-deafens, like Discord.
    if (this.state.deafened) return this.toggleDeafen();
    await this.setMic(!this.state.micMuted);
  }

  private async setMic(muted: boolean) {
    this.set({ micMuted: muted });
    try {
      await this.room?.localParticipant.setMicrophoneEnabled(!muted);
    } catch (err) {
      this.set({ micMuted: true, error: errorText(err) });
    }
    this.syncParticipants();
  }

  async toggleDeafen() {
    const deafened = !this.state.deafened;
    this.room?.remoteParticipants.forEach((p) => p.setVolume(deafened ? 0 : 1));
    if (deafened) {
      this.micMutedBeforeDeafen = this.state.micMuted;
      this.set({ deafened });
      await this.setMic(true);
    } else {
      this.set({ deafened });
      await this.setMic(this.micMutedBeforeDeafen);
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

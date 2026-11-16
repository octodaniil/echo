import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver, type ParticipantInfo } from 'livekit-server-sdk';
import { config } from './config.ts';
import type { User } from './db.ts';

export const roomService = new RoomServiceClient(
  config.livekitInternalUrl,
  config.livekitApiKey,
  config.livekitApiSecret,
);

export const webhookReceiver = new WebhookReceiver(config.livekitApiKey, config.livekitApiSecret);

export const roomNameForChannel = (channelId: number) => `ch-${channelId}`;

export function channelIdFromRoom(room: string): number | null {
  const m = /^ch-(\d+)$/.exec(room);
  return m ? Number(m[1]) : null;
}

export async function createJoinToken(user: User, channelId: number): Promise<string> {
  const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: user.id,
    name: user.nickname,
    ttl: config.livekitTokenTtl,
  });
  token.addGrant({
    room: roomNameForChannel(channelId),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Clients announce whose stream they watch via participant attributes (viewer counts).
    canUpdateOwnMetadata: true,
  });
  return token.toJwt();
}

export interface ChannelMember {
  id: string;
  nickname: string;
  /** Avatar version (see users.avatar_version), null when the user has none. */
  avatar: number | null;
  /** Achievement codes the user shows off. */
  pinned?: string[];
  streaming: boolean;
  joinedAt: number;
}

export function toMember(p: ParticipantInfo): ChannelMember {
  return {
    id: p.identity,
    nickname: p.name || p.identity,
    avatar: null,
    streaming: p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE),
    joinedAt: Number(p.joinedAt) * 1000,
  };
}

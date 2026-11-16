function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? './data/echo.db',
  livekitApiKey: required('LIVEKIT_API_KEY'),
  livekitApiSecret: required('LIVEKIT_API_SECRET'),
  /** Where the API talks to LiveKit (server-to-server). */
  livekitInternalUrl: process.env.LIVEKIT_INTERNAL_URL ?? 'http://127.0.0.1:7880',
  /** What clients connect to. */
  livekitPublicUrl: required('LIVEKIT_PUBLIC_URL'),
  /** Lifetime of a LiveKit join token. Clients reconnecting after this must ask again. */
  livekitTokenTtl: '12h',
};

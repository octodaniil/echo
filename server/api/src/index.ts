import Fastify from 'fastify';
import { HttpError } from './auth.ts';
import { config } from './config.ts';
import { startPresence } from './presence.ts';
import { registerRoutes } from './routes.ts';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // We sit behind Caddy on the same host.
  trustProxy: '127.0.0.1',
  bodyLimit: 64 * 1024,
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
  req.log.error({ err }, 'unhandled error');
  return reply.code(500).send({ error: 'Внутренняя ошибка сервера' });
});

await registerRoutes(app);
await app.listen({ host: config.host, port: config.port });
startPresence(app.log);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  });
}

/**
 * Diagnostics reports: whenever Echo had to fix the microphone or a friend's audio by itself
 * (or someone presses «Меня не слышно»), a short report goes to the server so the admin can
 * see what actually happens on friends' PCs. At most 30 an hour; failures are ignored.
 */
let sent: number[] = [];

export function report(kind: string, data: Record<string, unknown>) {
  const now = Date.now();
  sent = sent.filter((t) => now - t < 3_600_000);
  if (sent.length >= 30) return;
  sent.push(now);
  void window.echo.sendDiag(kind, data).catch(() => {});
}

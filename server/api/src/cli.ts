// Admin CLI. Run via server/deploy/admin.sh on the server.
import { parseArgs } from 'node:util';
import { createInvite } from './auth.ts';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { avatarDir, queries, type Channel, type Invite, type User } from './db.ts';
import { roomService } from './livekit.ts';

const [command, ...rest] = process.argv.slice(2);
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleString('ru-RU') : '—');

switch (command) {
  case 'invite': {
    const { values } = parseArgs({
      args: rest,
      options: {
        admin: { type: 'boolean', default: false },
        uses: { type: 'string' },
        hours: { type: 'string' },
      },
    });
    // Admin invites are single-use by default; regular ones default to unlimited uses.
    const maxUses = values.uses ? Number(values.uses) : values.admin ? 1 : null;
    const invite = createInvite({
      admin: values.admin,
      maxUses,
      expiresInHours: values.hours ? Number(values.hours) : null,
    });
    console.log(`Инвайт: ${invite.code}`);
    console.log(`  админ: ${invite.grants_admin ? 'да' : 'нет'}`);
    console.log(`  использований: ${invite.max_uses ?? 'без ограничений'}`);
    console.log(`  истекает: ${fmtDate(invite.expires_at)}`);
    break;
  }

  case 'invites': {
    const invites = queries.listInvites.all() as unknown as Invite[];
    if (!invites.length) console.log('Инвайтов нет');
    for (const i of invites) {
      console.log(
        `${i.code}  ${i.grants_admin ? '[admin] ' : ''}использовано ${i.uses}/${i.max_uses ?? '∞'}  истекает ${fmtDate(i.expires_at)}`,
      );
    }
    break;
  }

  case 'users': {
    const users = queries.listUsers.all() as unknown as User[];
    if (!users.length) console.log('Пользователей нет');
    for (const u of users) {
      console.log(`${u.nickname}${u.is_admin ? ' [admin]' : ''}  был в сети: ${fmtDate(u.last_seen_at)}  id=${u.id}`);
    }
    break;
  }

  case 'kick': {
    const nickname = rest.join(' ');
    const user = queries.userByNickname.get(nickname) as User | undefined;
    if (!user) {
      console.error(`Пользователь "${nickname}" не найден`);
      process.exit(1);
    }
    queries.deleteUser.run(user.id);
    rmSync(join(avatarDir, `${user.id}.webp`), { force: true });
    // Drop them from any voice channel they are sitting in right now.
    const rooms = await roomService.listRooms().catch(() => []);
    await Promise.all(rooms.map((r) => roomService.removeParticipant(r.name, user.id).catch(() => {})));
    console.log(`Удалён: ${user.nickname}. Его ключ доступа больше не действует.`);
    break;
  }

  case 'channels': {
    for (const c of queries.listChannels.all() as unknown as Channel[]) console.log(`#${c.id}  ${c.name}`);
    break;
  }

  default:
    console.log(`Команды:
  invite [--admin] [--uses N] [--hours H]   создать инвайт
  invites                                   список инвайтов
  users                                     список пользователей
  kick <ник>                                удалить пользователя
  channels                                  список каналов`);
    process.exit(command ? 1 : 0);
}

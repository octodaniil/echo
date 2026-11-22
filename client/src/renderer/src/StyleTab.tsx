import { playEntry } from './sounds';
import { useEffect, useState } from 'preact/hooks';
import type { Cosmetic, CosmeticsCatalog, CosmeticSlot, Look, Profile, Session } from '../../shared/types';
import { useCatalog } from './Achievements';
import { Avatar, Nick } from './Avatar';
import { levelProgress, lookVars, rankName, RINGS } from './look';

const GROUPS = [
  { id: 'basic', title: 'БАЗОВЫЕ — ДЛЯ ВСЕХ' },
  { id: 'level', title: 'ЗА УРОВЕНЬ' },
  { id: 'achievement', title: 'ЗА АЧИВКИ' },
  { id: 'pioneer', title: 'ДЛЯ ПЕРВООТКРЫВАТЕЛЕЙ — ТОЛЬКО ДЛЯ СВОИХ' },
  { id: 'exclusive', title: 'ЭКСКЛЮЗИВ АДМИНИСТРАЦИИ' },
] as const;

/** "Стиль": equip cosmetics unlocked by level and achievements, with a live preview. */
export function StyleTab({ session }: { session: Session }) {
  const [data, setData] = useState<CosmeticsCatalog | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  const [error, setError] = useState<string | null>(null);
  const achievements = useCatalog();
  const me = session.user;

  useEffect(() => {
    window.echo
      .getCosmetics()
      .then((d) => {
        setData(d);
        setLook(d.style);
      })
      .catch((e: Error) => setError(e.message));
    void window.echo.getProfile(me.id).then(setProfile).catch(() => {});
  }, []);

  const equip = async (slot: CosmeticSlot, id: string) => {
    if (!look) return;
    const prev = look;
    setLook({ ...look, [slot]: id });
    setError(null);
    try {
      setLook(await window.echo.setLook({ [slot]: id }));
    } catch (e) {
      setLook(prev);
      setError((e as Error).message);
    }
  };

  const requirement = (c: Cosmetic) => {
    if (c.unlock.role === 'admin') return 'Только админ';
    if (c.unlock.role === 'staff') return 'Админ и модераторы';
    if (c.unlock.role === 'pioneer') return 'Для первооткрывателей';
    if (c.unlock.level) return `Уровень ${c.unlock.level}`;
    if (c.unlock.achievement) {
      const def = achievements.find((a) => a.code === c.unlock.achievement);
      return def ? (def.hidden && def.title === 'Скрытая ачивка' ? 'Секретная ачивка' : `Ачивка «${def.title}»`) : 'Особая ачивка';
    }
    if (c.unlock.unique) return 'Любая уникальная ачивка';
    return '';
  };

  if (!data || !look) {
    return (
      <div class="settings-page">
        <h2>Стиль</h2>
        <p class="muted">{error ?? 'Загружаем…'}</p>
      </div>
    );
  }

  const p = profile?.prestige;
  const opened = data.items.filter((i) => i.unlocked).length;

  return (
    <div class="settings-page">
      <h2>Стиль</h2>
      <p class="muted">
        {me.isAdmin
          ? 'Тебе как админу открыто всё — выбирай что угодно.'
          : `Новые цвета, рамки и эффекты открываются с уровнем и за ачивки. Открыто ${opened} из ${data.items.length}.`}
      </p>

      <div class="style-preview" style={lookVars(look)}>
        <Avatar
          id={me.id}
          name={me.nickname}
          avatar={me.avatar}
          size={88}
          prestige={p}
          look={look}
          uniques={profile?.uniques}
          animated
        />
        <div class="style-preview-info">
          <div class="style-preview-name">
            <Nick name={me.nickname} look={look} />
          </div>
          {p && (
            <div class="muted tiny mono">
              {rankName(p)} · уровень {p.level} · {Math.round(levelProgress(p) * 100)}% до следующего
            </div>
          )}
          <div class={`member plate-${look.plate} style-preview-row`} style={lookVars(look)}>
            <Avatar id={me.id} name={me.nickname} avatar={me.avatar} size={22} prestige={p} look={look} />
            <span class="member-main">
              <span class="member-name">
                <Nick name={me.nickname} look={look} />
              </span>
              <span class="member-game idle">так тебя видят в списке</span>
            </span>
          </div>
        </div>
      </div>

      {error && <div class="error">{error}</div>}

      {data.slots.map((slot) => (
        <div key={slot.id}>
          <h3>{slot.title}</h3>
          {GROUPS.map((g) => {
            const items = data.items.filter((c) => c.slot === slot.id && c.group === g.id);
            if (items.length === 0) return null;
            return (
              <div key={g.id}>
          <div class={`cosmetic-group ${g.id}`}>{g.title}</div>
          <div class={`cosmetics${slot.id === 'frame' ? ' frames' : ''}`}>
            {items
              .map((c) => {
                const active = look[slot.id] === c.id;
                const preview: Look = { ...look, [slot.id]: c.id };
                return (
                  <button
                    key={c.id}
                    class={`cosmetic${active ? ' active' : ''}${c.unlocked ? '' : ' locked'}${c.group === 'exclusive' ? ' exclusive' : ''}`}
                    disabled={!c.unlocked && slot.id !== 'sound'}
                    title={c.unlocked ? c.title : `${c.title} — ${requirement(c)}`}
                    onClick={() => {
                      if (slot.id === 'sound') void playEntry(c.id, true);
                      if (c.unlocked) void equip(slot.id, c.id);
                    }}
                  >
                    <span class={`cosmetic-preview${slot.id === 'frame' ? ' frame-preview' : ''}`} style={lookVars(preview)}>
                      {slot.id === 'ring' && (
                        <span class="ring-swatch" style={{ background: RINGS[c.id]?.bg ?? RINGS[c.id]?.c }} />
                      )}
                      {slot.id === 'frame' && (
                        <Avatar
                          id={me.id}
                          name={me.nickname}
                          avatar={me.avatar}
                          size={56}
                          prestige={p}
                          look={preview}
                          animated={active}
                        />
                      )}
                      {slot.id === 'name' && <Nick name={me.nickname} look={preview} class="cosmetic-nick" />}
                      {slot.id === 'plate' && <span class={`plate-swatch member plate-${c.id}`} />}
                      {slot.id === 'sound' && (
                        <svg class="sound-swatch" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                          <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" />
                        </svg>
                      )}
                    </span>
                    <span class="cosmetic-title">{c.title}</span>
                    {(!c.unlocked || c.group === 'exclusive') && (
                      <span class={`cosmetic-lock mono${c.unlock.role ? ' role' : ''}`}>{requirement(c)}</span>
                    )}
                  </button>
                );
              })}
          </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

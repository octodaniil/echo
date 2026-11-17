import { useEffect, useState } from 'preact/hooks';
import type { Cosmetic, CosmeticsCatalog, CosmeticSlot, Look, Profile, Session } from '../../shared/types';
import { useCatalog } from './Achievements';
import { Avatar, Nick } from './Avatar';
import { levelProgress, lookVars, rankName, RINGS } from './look';

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
          <div class="cosmetics">
            {data.items
              .filter((c) => c.slot === slot.id)
              .map((c) => {
                const active = look[slot.id] === c.id;
                const preview: Look = { ...look, [slot.id]: c.id };
                return (
                  <button
                    key={c.id}
                    class={`cosmetic${active ? ' active' : ''}${c.unlocked ? '' : ' locked'}`}
                    disabled={!c.unlocked}
                    title={c.unlocked ? c.title : `${c.title} — ${requirement(c)}`}
                    onClick={() => void equip(slot.id, c.id)}
                  >
                    <span class="cosmetic-preview" style={lookVars(preview)}>
                      {slot.id === 'ring' && (
                        <span class="ring-swatch" style={{ background: RINGS[c.id]?.bg ?? RINGS[c.id]?.c }} />
                      )}
                      {slot.id === 'frame' && (
                        <Avatar
                          id={me.id}
                          name={me.nickname}
                          avatar={me.avatar}
                          size={40}
                          prestige={p}
                          look={preview}
                          animated={false}
                        />
                      )}
                      {slot.id === 'name' && <Nick name={me.nickname} look={preview} class="cosmetic-nick" />}
                      {slot.id === 'plate' && <span class={`plate-swatch member plate-${c.id}`} />}
                    </span>
                    <span class="cosmetic-title">{c.title}</span>
                    {!c.unlocked && <span class="cosmetic-lock mono">{requirement(c)}</span>}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

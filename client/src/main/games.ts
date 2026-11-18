import { execFile } from 'node:child_process';

/**
 * "Playing CS2" detection, the way Discord does it: look at running process names every
 * so often and match them against a list of known games (+ the user's own entries).
 * One `tasklist` call every 15 s costs a few milliseconds of CPU.
 */

// Lower-case executable name -> display name.
const KNOWN: Record<string, string> = {
  'cs2.exe': 'Counter-Strike 2',
  'csgo.exe': 'CS:GO',
  'hl.exe': 'Half-Life / CS 1.6',
  'dota2.exe': 'Dota 2',
  'valorant-win64-shipping.exe': 'Valorant',
  'r5apex.exe': 'Apex Legends',
  'r5apex_dx12.exe': 'Apex Legends',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'league of legends.exe': 'League of Legends',
  'overwatch.exe': 'Overwatch 2',
  'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_vulkan.exe': 'Rainbow Six Siege',
  'rainbowsix_be.exe': 'Rainbow Six Siege',
  'tslgame.exe': 'PUBG: Battlegrounds',
  'destiny2.exe': 'Destiny 2',
  'escapefromtarkov.exe': 'Escape from Tarkov',
  'rustclient.exe': 'Rust',
  'dayz_x64.exe': 'DayZ',
  'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
  'phasmophobia.exe': 'Phasmophobia',
  'lethal company.exe': 'Lethal Company',
  'r.e.p.o..exe': 'R.E.P.O.',
  'content warning.exe': 'Content Warning',
  'peak.exe': 'PEAK',
  'schedule i.exe': 'Schedule I',
  'palworld-win64-shipping.exe': 'Palworld',
  'helldivers2.exe': 'Helldivers 2',
  'marvel-win64-shipping.exe': 'Marvel Rivals',
  'discovery.exe': 'The Finals',
  'deadlock.exe': 'Deadlock',
  'project8.exe': 'Deadlock', // early playtest builds used the codename
  'deltaforceclient-win64-shipping.exe': 'Delta Force',
  'battlebit.exe': 'BattleBit Remastered',
  'insurgencyclient-win64-shipping.exe': 'Insurgency: Sandstorm',
  'squadgame.exe': 'Squad',
  'hll-win64-shipping.exe': 'Hell Let Loose',
  'readyornot-win64-shipping.exe': 'Ready or Not',
  'arma3_x64.exe': 'Arma 3',
  'bf2042.exe': 'Battlefield 2042',
  'bf1.exe': 'Battlefield 1',
  'bfv.exe': 'Battlefield V',
  'bf6.exe': 'Battlefield 6',
  'cod.exe': 'Call of Duty',
  'modernwarfare.exe': 'Call of Duty: Modern Warfare',
  'chivalry2-win64-shipping.exe': 'Chivalry 2',
  'forhonor.exe': 'For Honor',
  'narakabladepoint.exe': 'Naraka: Bladepoint',
  'worldoftanks.exe': 'World of Tanks',
  'tanki.exe': 'Мир танков',
  'worldofwarships64.exe': 'World of Warships',
  'aces.exe': 'War Thunder',
  'crossout.exe': 'Crossout',
  'warframe.x64.exe': 'Warframe',
  'gta5.exe': 'GTA V',
  'gta5_enhanced.exe': 'GTA V',
  'gta_sa.exe': 'GTA: San Andreas',
  'rdr2.exe': 'Red Dead Redemption 2',
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'witcher3.exe': 'The Witcher 3',
  'bg3.exe': "Baldur's Gate 3",
  'bg3_dx11.exe': "Baldur's Gate 3",
  'eldenring.exe': 'Elden Ring',
  'nightreign.exe': 'Elden Ring Nightreign',
  'sekiro.exe': 'Sekiro',
  'darksoulsiii.exe': 'Dark Souls III',
  'lop-win64-shipping.exe': 'Lies of P',
  'monsterhunterwilds.exe': 'Monster Hunter Wilds',
  'monsterhunterworld.exe': 'Monster Hunter: World',
  'stalker2-win64-shipping.exe': 'S.T.A.L.K.E.R. 2',
  'anomalydx11.exe': 'S.T.A.L.K.E.R. Anomaly',
  'metroexodus.exe': 'Metro Exodus',
  'atomicheart-win64-shipping.exe': 'Atomic Heart',
  'hogwartslegacy.exe': 'Hogwarts Legacy',
  'starfield.exe': 'Starfield',
  'fallout4.exe': 'Fallout 4',
  'skyrimse.exe': 'Skyrim',
  'kingdomcome.exe': 'Kingdom Come: Deliverance',
  'b1-win64-shipping.exe': 'Black Myth: Wukong',
  'sandfall-win64-shipping.exe': 'Clair Obscur: Expedition 33',
  're4.exe': 'Resident Evil 4',
  're8.exe': 'Resident Evil Village',
  'shproto-win64-shipping.exe': 'Silent Hill 2',
  'ghostoftsushima.exe': 'Ghost of Tsushima',
  'gow.exe': 'God of War',
  'dyinglightgame_x64_rwdi.exe': 'Dying Light 2',
  'dyinglightgame.exe': 'Dying Light',
  'remnant2-win64-shipping.exe': 'Remnant 2',
  'fsd-win64-shipping.exe': 'Deep Rock Galactic',
  'risk of rain 2.exe': 'Risk of Rain 2',
  'valheim.exe': 'Valheim',
  'enshrouded.exe': 'Enshrouded',
  'vrising.exe': 'V Rising',
  'conansandbox.exe': 'Conan Exiles',
  'arkascended.exe': 'ARK: Survival Ascended',
  'sonsoftheforest.exe': 'Sons of the Forest',
  'theforest.exe': 'The Forest',
  'raft.exe': 'Raft',
  'subnautica.exe': 'Subnautica',
  'maine-win64-shipping.exe': 'Grounded',
  '7daystodie.exe': '7 Days to Die',
  'projectzomboid64.exe': 'Project Zomboid',
  'sotgame.exe': 'Sea of Thieves',
  'factorygame-win64-shipping.exe': 'Satisfactory',
  'factorygamesteam-win64-shipping.exe': 'Satisfactory',
  'factorio.exe': 'Factorio',
  'terraria.exe': 'Terraria',
  'stardew valley.exe': 'Stardew Valley',
  'dontstarve_steam_x64.exe': "Don't Starve Together",
  'ittakestwo.exe': 'It Takes Two',
  'among us.exe': 'Among Us',
  'fallguys_client_game.exe': 'Fall Guys',
  'rocketleague.exe': 'Rocket League',
  'robloxplayerbeta.exe': 'Roblox',
  'minecraft.windows.exe': 'Minecraft',
  'brawlhalla.exe': 'Brawlhalla',
  'left4dead2.exe': 'Left 4 Dead 2',
  'tf_win64.exe': 'Team Fortress 2',
  'gmod.exe': "Garry's Mod",
  'portal2.exe': 'Portal 2',
  'hlvr.exe': 'Half-Life: Alyx',
  'wow.exe': 'World of Warcraft',
  'wowclassic.exe': 'WoW Classic',
  'hearthstone.exe': 'Hearthstone',
  'diablo iv.exe': 'Diablo IV',
  'diablo iii64.exe': 'Diablo III',
  'pathofexile_x64.exe': 'Path of Exile',
  'pathofexile.exe': 'Path of Exile',
  'pathofexile2.exe': 'Path of Exile 2',
  'lostark.exe': 'Lost Ark',
  'blackdesert64.exe': 'Black Desert',
  'genshinimpact.exe': 'Genshin Impact',
  'starrail.exe': 'Honkai: Star Rail',
  'zenlesszonezero.exe': 'Zenless Zone Zero',
  'osu!.exe': 'osu!',
  'geometrydash.exe': 'Geometry Dash',
  'hollow_knight.exe': 'Hollow Knight',
  'hades.exe': 'Hades',
  'hades2.exe': 'Hades II',
  'deadcells.exe': 'Dead Cells',
  'cuphead.exe': 'Cuphead',
  'celeste.exe': 'Celeste',
  'balatro.exe': 'Balatro',
  'vampiresurvivors.exe': 'Vampire Survivors',
  'snap.exe': 'Marvel Snap',
  'mk12.exe': 'Mortal Kombat 1',
  'polaris-win64-shipping.exe': 'Tekken 8',
  'streetfighter6.exe': 'Street Fighter 6',
  'eurotrucks2.exe': 'Euro Truck Simulator 2',
  'amtrucks.exe': 'American Truck Simulator',
  'snowrunner.exe': 'SnowRunner',
  'forzahorizon5.exe': 'Forza Horizon 5',
  'forzahorizon4.exe': 'Forza Horizon 4',
  'needforspeedheat.exe': 'Need for Speed Heat',
  'acs.exe': 'Assetto Corsa',
  'beamng.drive.x64.exe': 'BeamNG.drive',
  'fc25.exe': 'EA SPORTS FC 25',
  'fc26.exe': 'EA SPORTS FC 26',
  'bannerlord.exe': 'Mount & Blade II: Bannerlord',
  'warhammer3.exe': 'Total War: Warhammer III',
  'civilizationvi.exe': 'Civilization VI',
  'civilizationvii.exe': 'Civilization VII',
  'hoi4.exe': 'Hearts of Iron IV',
  'eu4.exe': 'Europa Universalis IV',
  'ck3.exe': 'Crusader Kings III',
  'stellaris.exe': 'Stellaris',
  'aoe2de_s.exe': 'Age of Empires II',
  'sc2_x64.exe': 'StarCraft II',
  'h3hota.exe': 'Heroes III (HotA)',
  'cities.exe': 'Cities: Skylines',
  'ts4_x64.exe': 'The Sims 4',
  'rimworldwin64.exe': 'RimWorld',
  'oxygennotincluded.exe': 'Oxygen Not Included',
};

/** Known games for the settings list: unique names, each with its executables. */
/**
 * Launchers, chat apps, browsers and tools are never "a game", even if someone added
 * them as their own game (Steam showed up as "playing Steam" this way).
 */
const NOT_GAMES = new Set([
  'steam.exe', 'steamwebhelper.exe', 'steamservice.exe',
  'epicgameslauncher.exe', 'epicwebhelper.exe', 'battle.net.exe', 'agent.exe',
  'eadesktop.exe', 'origin.exe', 'ubisoftconnect.exe', 'upc.exe', 'galaxyclient.exe',
  'riotclientservices.exe', 'riotclientux.exe', 'riotclientuxrender.exe', 'leagueclient.exe', 'leagueclientux.exe',
  'xboxpcapp.exe', 'gamebar.exe', 'playnite.desktopapp.exe', 'lghub.exe', 'nvidia app.exe', 'nvcontainer.exe',
  'discord.exe', 'telegram.exe', 'whatsapp.exe', 'teamspeak3.exe', 'ts3client_win64.exe', 'skype.exe', 'zoom.exe',
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'opera_gx.exe', 'browser.exe', 'brave.exe', 'yandex.exe',
  'code.exe', 'obs64.exe', 'obs32.exe', 'spotify.exe', 'notepad.exe', 'explorer.exe', 'taskmgr.exe',
  'echo.exe', 'electron.exe',
]);

export function knownGames(): { name: string; exes: string[] }[] {
  const byName = new Map<string, string[]>();
  for (const [exe, name] of Object.entries(KNOWN)) byName.set(name, [...(byName.get(name) ?? []), exe]);
  return [...byName].map(([name, exes]) => ({ name, exes })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export interface GamesConfig {
  enabled: boolean;
  /** User's own entries: exe (lower-case) -> name. */
  custom: Record<string, string>;
}

function listProcesses(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => {
      if (err) return resolve([]);
      resolve(out.split(/\r?\n/).map((l) => (/^"([^"]+)"/.exec(l)?.[1] ?? '').toLowerCase()).filter(Boolean));
    });
  });
}

export async function detectGame(config: GamesConfig): Promise<string | null> {
  const running = await listProcesses();
  for (const exe of running) if (config.custom[exe] && !NOT_GAMES.has(exe)) return config.custom[exe]!;
  for (const exe of running) if (KNOWN[exe]) return KNOWN[exe]!;
  return null;
}

/** Programs with a visible window, to pick a game that isn't in the list. */
export function listWindowedApps(): Promise<{ exe: string; title: string }[]> {
  const script =
    "Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { [pscustomobject]@{ exe = ($_.ProcessName + '.exe'); title = $_.MainWindowTitle } } | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (err, out) => {
      if (err || !out.trim()) return resolve([]);
      try {
        const parsed = JSON.parse(out) as { exe: string; title: string } | { exe: string; title: string }[];
        const list = (Array.isArray(parsed) ? parsed : [parsed]).map((a) => ({ exe: a.exe.toLowerCase(), title: a.title }));
        const skip = new Set(['applicationframehost.exe', 'textinputhost.exe', 'systemsettings.exe']);
        resolve(list.filter((a) => !skip.has(a.exe) && !NOT_GAMES.has(a.exe)));
      } catch {
        resolve([]);
      }
    });
  });
}

/** Polls every 15 s and calls back when the detected game changes. */
export function startGameWatcher(getConfig: () => GamesConfig, onChange: (game: string | null) => void) {
  let current: string | null = null;
  let stopped = false;
  const tick = async () => {
    const cfg = getConfig();
    const game = cfg.enabled ? await detectGame(cfg) : null;
    if (stopped) return;
    if (game !== current) {
      current = game;
      onChange(game);
    }
  };
  void tick();
  const t = setInterval(() => void tick(), 15_000);
  return {
    get current() {
      return current;
    },
    /** Re-check right away (settings changed). */
    refresh: () => void tick(),
    stop: () => {
      stopped = true;
      clearInterval(t);
    },
  };
}

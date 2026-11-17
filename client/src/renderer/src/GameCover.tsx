import { useState } from 'preact/hooks';

/** Steam app ids for known games (display name -> id). Games not on Steam get a drawn cover. */
const STEAM: Record<string, number> = {
  '7 Days to Die': 251570,
  'ARK: Survival Ascended': 2399830,
  'Age of Empires II': 813780,
  'American Truck Simulator': 270880,
  'Among Us': 945360,
  'Apex Legends': 1172470,
  'Arma 3': 107410,
  'Assetto Corsa': 244210,
  'Atomic Heart': 668580,
  Balatro: 2379780,
  'BattleBit Remastered': 671860,
  'Battlefield 1': 1238840,
  'Battlefield 2042': 1517290,
  'Battlefield 6': 2807960,
  'Battlefield V': 1238810,
  'BeamNG.drive': 284160,
  'Black Desert': 582660,
  'Black Myth: Wukong': 2358720,
  Brawlhalla: 291550,
  'CS:GO': 730,
  'Call of Duty': 1938090,
  'Call of Duty: Modern Warfare': 1938090,
  Celeste: 504230,
  'Chivalry 2': 1824220,
  'Cities: Skylines': 255710,
  'Civilization VI': 289070,
  'Civilization VII': 1295660,
  'Clair Obscur: Expedition 33': 1903340,
  'Conan Exiles': 440900,
  'Content Warning': 2881650,
  'Counter-Strike 2': 730,
  Crossout: 386180,
  'Crusader Kings III': 1158310,
  Cuphead: 268910,
  'Cyberpunk 2077': 1091500,
  'Dark Souls III': 374320,
  DayZ: 221100,
  'Dead Cells': 588650,
  'Dead by Daylight': 381210,
  Deadlock: 1422450,
  'Deep Rock Galactic': 548430,
  'Delta Force': 2507950,
  'Destiny 2': 1085660,
  'Diablo IV': 2344520,
  'Dota 2': 570,
  'Dying Light 2': 534380,
  'Dying Light': 239140,
  'EA SPORTS FC 25': 2669320,
  'Elden Ring Nightreign': 2622380,
  'Elden Ring': 1245620,
  Enshrouded: 1203620,
  'Euro Truck Simulator 2': 227300,
  'Europa Universalis IV': 236850,
  Factorio: 427520,
  'Fall Guys': 1097150,
  'Fallout 4': 377160,
  'For Honor': 304390,
  'Forza Horizon 4': 1293830,
  'Forza Horizon 5': 1551360,
  'GTA V': 271590,
  'GTA: San Andreas': 12120,
  'Geometry Dash': 322170,
  'Ghost of Tsushima': 2215430,
  'God of War': 1593500,
  Grounded: 962130,
  'Hades II': 1145350,
  Hades: 1145360,
  'Half-Life / CS 1.6': 10,
  'Half-Life: Alyx': 546560,
  'Hearts of Iron IV': 394360,
  'Hell Let Loose': 686810,
  'Helldivers 2': 553850,
  'Hogwarts Legacy': 990080,
  'Hollow Knight': 367520,
  'Insurgency: Sandstorm': 581320,
  'It Takes Two': 1426210,
  'Kingdom Come: Deliverance': 379430,
  'Left 4 Dead 2': 550,
  'Lethal Company': 1966720,
  'Lies of P': 1627720,
  'Lost Ark': 1599340,
  'Marvel Rivals': 2767030,
  'Marvel Snap': 1997040,
  'Metro Exodus': 412020,
  'Monster Hunter Wilds': 2246340,
  'Monster Hunter: World': 582010,
  'Mortal Kombat 1': 1971870,
  'Mount & Blade II: Bannerlord': 261550,
  'Naraka: Bladepoint': 1203220,
  'Need for Speed Heat': 1222680,
  'Overwatch 2': 2357570,
  'Oxygen Not Included': 457140,
  PEAK: 3527290,
  'PUBG: Battlegrounds': 578080,
  Palworld: 1623730,
  'Path of Exile 2': 2694490,
  'Path of Exile': 238960,
  Phasmophobia: 739630,
  'Portal 2': 620,
  'Project Zomboid': 108600,
  'R.E.P.O.': 3241660,
  Raft: 648800,
  'Rainbow Six Siege': 359550,
  'Ready or Not': 1144200,
  'Red Dead Redemption 2': 1174180,
  'Remnant 2': 1282100,
  'Resident Evil 4': 2050650,
  'Resident Evil Village': 1196590,
  RimWorld: 294100,
  'Risk of Rain 2': 632360,
  'Rocket League': 252950,
  Rust: 252490,
  'S.T.A.L.K.E.R. 2': 1643320,
  Satisfactory: 526870,
  'Schedule I': 3164500,
  'Sea of Thieves': 1172620,
  Sekiro: 814380,
  'Silent Hill 2': 2124490,
  Skyrim: 489830,
  SnowRunner: 1465360,
  'Sons of the Forest': 1326470,
  Squad: 393380,
  'Stardew Valley': 413150,
  Starfield: 1716740,
  Stellaris: 281990,
  'Street Fighter 6': 1364780,
  Subnautica: 264710,
  'Team Fortress 2': 440,
  'Tekken 8': 1778820,
  Terraria: 105600,
  'The Finals': 2073850,
  'The Forest': 242760,
  'The Sims 4': 1222670,
  'The Witcher 3': 292030,
  'Total War: Warhammer III': 1142710,
  'V Rising': 1604030,
  Valheim: 892970,
  'Vampire Survivors': 1794680,
  'War Thunder': 236390,
  Warframe: 230410,
  'World of Tanks': 1407200,
  'World of Warships': 552990,
};

export function coverUrl(game: string): string | null {
  const id = STEAM[game];
  return id ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg` : null;
}

function hue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Steam header art (460×215), or a drawn cover with the game's initials. */
export function GameCover({ game, width = 92 }: { game: string; width?: number }) {
  const url = coverUrl(game);
  const [failed, setFailed] = useState(false);
  const height = Math.round((width * 215) / 460);
  if (url && !failed) {
    return (
      <img
        class="game-cover"
        src={url}
        alt=""
        width={width}
        height={height}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }
  const h = hue(game);
  const initials = game
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span
      class="game-cover drawn"
      style={{
        width,
        height,
        fontSize: Math.round(height * 0.42),
        background: `linear-gradient(135deg, hsl(${h} 55% 30%), hsl(${(h + 60) % 360} 55% 18%))`,
      }}
    >
      {initials || '🎮'}
    </span>
  );
}

// Genre registry — the single source of truth for what "genre" means across the
// ingest pipeline, the server settings allowlist, and the client's lobby picker.
//
// Two kinds of membership exist, because Apple's `primaryGenreName` is coarse:
//
//   1. MATCHED — the family is recognisable from Apple's own genre label
//      (Pop, Rock, Country, K-Pop, …). Any ingested track whose label matches
//      the family regex joins that family automatically.
//   2. SEEDED — the family has no distinct Apple label. Drill and trap are both
//      filed under "Hip-Hop/Rap", so the only way to build those pools is to
//      ingest from artists known to belong to the scene. Tracks pulled through a
//      seeded family's artist list are tagged with that family key at ingest.
//
// A track can belong to several families at once (a Hip-Hop/Rap track is in both
// `hip-hop` and `rap`; a Pop Smoke track is additionally in `drill`), which is
// why rows carry a `genreKeys` array rather than one genre column.

// Every family: { label, match, seedArtists }.
//   match       — RegExp against Apple's primaryGenreName. null = seeded-only.
//   seedArtists — names used by the deep ingest to pull each artist's catalogue
//                 (up to 200 tracks per artist). Also the ONLY source for
//                 seeded-only families.
export const GENRE_FAMILIES = {
  "hip-hop": {
    label: "Hip-Hop",
    match: /hip-?hop|rap/i,
    seedArtists: [
      "Kendrick Lamar", "Drake", "J. Cole", "Travis Scott", "Nicki Minaj", "Eminem",
      "Kanye West", "Lil Wayne", "Cardi B", "A$AP Rocky", "Tyler, The Creator",
      "Doja Cat", "Megan Thee Stallion", "21 Savage", "Jay-Z", "Nas", "Snoop Dogg",
      "Missy Elliott", "Outkast", "Ice Spice",
    ],
  },
  rap: {
    label: "Rap",
    match: /hip-?hop|rap/i,
    seedArtists: [
      "Lil Baby", "DaBaby", "Roddy Ricch", "Gunna", "Jack Harlow", "Latto",
      "GloRilla", "Sexyy Red", "Rod Wave", "NBA YoungBoy", "Polo G", "Lil Durk",
      "Moneybagg Yo", "Key Glock", "Sleepy Hallow", "Coi Leray",
    ],
  },
  drill: {
    label: "Drill",
    match: null, // Apple files drill under Hip-Hop/Rap — seeded only.
    seedArtists: [
      "Pop Smoke", "Central Cee", "Fivio Foreign", "Headie One", "Digga D",
      "Sheff G", "Kay Flock", "Russ Millions", "Unknown T", "Bandmanrill",
      "22Gz", "Lil Tjay", "Dusty Locane", "Set Da Trend",
    ],
  },
  trap: {
    label: "Trap",
    match: null, // Same as drill — the label collides with Hip-Hop/Rap.
    seedArtists: [
      "Future", "Young Thug", "Migos", "Gucci Mane", "Playboi Carti", "Lil Uzi Vert",
      "2 Chainz", "Metro Boomin", "Rae Sremmurd", "Offset", "Quavo", "Lil Yachty",
      "Yeat", "Ken Carson", "Don Toliver",
    ],
  },
  "r&b": {
    label: "R&B",
    match: /r&b|soul|funk/i,
    seedArtists: [
      "SZA", "The Weeknd", "Beyoncé", "Frank Ocean", "H.E.R.", "Summer Walker",
      "Brent Faiyaz", "Chris Brown", "Usher", "Alicia Keys", "Jhené Aiko",
      "Daniel Caesar", "Giveon", "Victoria Monét", "Muni Long", "Rihanna",
    ],
  },
  pop: {
    label: "Pop",
    match: /^pop|pop\b|singer\/songwriter/i,
    seedArtists: [
      "Taylor Swift", "Ariana Grande", "Dua Lipa", "Billie Eilish", "Ed Sheeran",
      "Sabrina Carpenter", "Olivia Rodrigo", "Harry Styles", "Bruno Mars",
      "Justin Bieber", "Katy Perry", "Lady Gaga", "Sia", "Charlie Puth",
      "Miley Cyrus", "Adele", "Chappell Roan", "Tate McRae",
    ],
  },
  rock: {
    label: "Rock",
    match: /rock|grunge|punk/i,
    seedArtists: [
      "Queen", "Nirvana", "Foo Fighters", "Linkin Park", "AC/DC", "The Beatles",
      "Red Hot Chili Peppers", "Guns N' Roses", "Green Day", "Imagine Dragons",
      "Coldplay", "The Killers", "Led Zeppelin", "Pearl Jam", "Blink-182",
      "Fall Out Boy", "Paramore",
    ],
  },
  alternative: {
    label: "Indie",
    match: /alternative|indie/i,
    seedArtists: [
      "Arctic Monkeys", "Tame Impala", "The 1975", "Radiohead", "Lana Del Rey",
      "Hozier", "Glass Animals", "Cage The Elephant", "Phoebe Bridgers",
      "Mitski", "The Strokes", "Vampire Weekend", "Beabadoobee", "Wallows",
    ],
  },
  country: {
    label: "Country",
    match: /country|americana|bluegrass/i,
    seedArtists: [
      "Morgan Wallen", "Luke Combs", "Zach Bryan", "Chris Stapleton", "Jelly Roll",
      "Kacey Musgraves", "Carrie Underwood", "Blake Shelton", "Lainey Wilson",
      "Tyler Childers", "Johnny Cash", "Dolly Parton", "Shaboozey", "Post Malone",
    ],
  },
  dance: {
    label: "Dance",
    match: /dance|electronic|house|techno|edm|trance|dubstep/i,
    seedArtists: [
      "Calvin Harris", "David Guetta", "Avicii", "Swedish House Mafia", "Fred again..",
      "Skrillex", "Daft Punk", "Marshmello", "Kygo", "Tiësto", "Peggy Gou",
      "Disclosure", "Deadmau5", "Zedd", "John Summit",
    ],
  },
  latin: {
    label: "Latin",
    match: /latin|urbano|reggaet|mexicana|regional mexican|salsa|bachata|sertanejo|brazil|funk carioca/i,
    seedArtists: [
      "Bad Bunny", "Karol G", "Peso Pluma", "Feid", "Rauw Alejandro", "J Balvin",
      "Shakira", "Maluma", "Grupo Frontera", "Fuerza Regida", "Junior H",
      "Anuel AA", "Ozuna", "Daddy Yankee", "Rosalía", "Anitta",
    ],
  },
  afrobeats: {
    label: "Afrobeats",
    match: /afro|african|amapiano|highlife|afrobeat/i,
    seedArtists: [
      "Burna Boy", "Wizkid", "Davido", "Rema", "Asake", "Tems", "Ayra Starr",
      "Omah Lay", "Fireboy DML", "Tyla", "Ckay", "Olamide", "Kizz Daniel",
      "Black Sherif", "Focalistic",
    ],
  },
  "k-pop": {
    label: "K-Pop",
    match: /k-?pop|korean|j-?pop|c-?pop|anime/i,
    seedArtists: [
      "BTS", "BLACKPINK", "Stray Kids", "NewJeans", "TWICE", "SEVENTEEN",
      "aespa", "IVE", "LE SSERAFIM", "Jungkook", "Jimin", "ITZY", "TXT",
      "(G)I-DLE", "ENHYPEN",
    ],
  },
  bollywood: {
    label: "Bollywood",
    match: /bollywood|indian|hindi|tamil|telugu|punjabi|desi/i,
    seedArtists: [
      "Arijit Singh", "A.R. Rahman", "Diljit Dosanjh", "Shreya Ghoshal",
      "Neha Kakkar", "Badshah", "Pritam", "Anirudh Ravichander", "Sid Sriram",
      "Karan Aujla", "AP Dhillon", "Atif Aslam", "Sonu Nigam", "Armaan Malik",
    ],
  },
  metal: {
    label: "Metal",
    match: /metal|hard rock/i,
    seedArtists: [
      "Metallica", "Slipknot", "System of a Down", "Iron Maiden", "Black Sabbath",
      "Bring Me The Horizon", "Avenged Sevenfold", "Megadeth", "Ghost",
      "Rammstein", "Sleep Token", "Bad Omens", "Pantera",
    ],
  },
  reggae: {
    label: "Reggae",
    match: /reggae|dancehall|ska|soca/i,
    seedArtists: [
      "Bob Marley & The Wailers", "Sean Paul", "Shaggy", "Vybz Kartel", "Popcaan",
      "Damian Marley", "Skip Marley", "Koffee", "Chronixx", "Beenie Man",
      "Buju Banton", "Masicka",
    ],
  },
};

// Ordered list of playable genre keys. First entry is the game default, so this
// order must stay stable: gameLogic's sanitizeSettings falls back to it.
export const GENRE_KEYS = Object.keys(GENRE_FAMILIES);

// Families whose members can be recognised from Apple's own genre label.
export const MATCHED_GENRE_KEYS = GENRE_KEYS.filter((k) => GENRE_FAMILIES[k].match);

// Which families an Apple genre label belongs to. Seeded-only families are never
// returned here — they are tagged at ingest time from the seeding artist.
export function familiesForAppleGenre(appleGenre) {
  const name = String(appleGenre ?? "");
  if (!name) return [];
  return MATCHED_GENRE_KEYS.filter((key) => GENRE_FAMILIES[key].match.test(name));
}

export function isGenreKey(key) {
  return Object.prototype.hasOwnProperty.call(GENRE_FAMILIES, String(key ?? "").toLowerCase());
}

export function seedArtistsFor(key) {
  const fam = GENRE_FAMILIES[String(key ?? "").toLowerCase()];
  return fam ? fam.seedArtists.slice() : [];
}

export default GENRE_FAMILIES;

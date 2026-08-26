// Genre registry — the single source of truth for what "genre" means across the
// ingest pipeline, the server settings allowlist, and the client's lobby picker.
//
// Two kinds of membership exist, because Apple's `primaryGenreName` is coarse:
//
//   1. MATCHED — the family is recognisable from Apple's own genre label
//      (Pop, Country, Bollywood, …). Any ingested track whose label matches
//      the family regex joins that family automatically.
//   2. SEEDED — the family has no distinct Apple label. Drill and trap are two
//      DIFFERENT scenes (trap: Atlanta — Future/Migos lineage; drill: Chicago,
//      then UK/Brooklyn — Pop Smoke/Central Cee lineage) but Apple files both
//      under "Hip-Hop/Rap", so their pools can only be built from artists known
//      to belong to each scene. Tracks pulled through a seeded family's artist
//      list are tagged with that family key at ingest.
//
// A track can belong to several families at once (every drill track is also in
// `hip-hop`), which is why rows carry a `genreKeys` array, not one genre column.

// Every family: { label, match, seedArtists }.
//   match       — RegExp against Apple's primaryGenreName. null = seeded-only.
//   seedArtists — names used by the deep ingest to pull each artist's catalogue
//                 (up to 200 tracks per artist). Also the ONLY source for
//                 seeded-only families.
export const GENRE_FAMILIES = {
  // Hip-hop and rap are one family: the terms name the same catalogue, and
  // Apple itself uses a single "Hip-Hop/Rap" label.
  "hip-hop": {
    label: "Hip-Hop",
    match: /hip-?hop|rap/i,
    seedArtists: [
      "Kendrick Lamar", "Drake", "J. Cole", "Travis Scott", "Nicki Minaj", "Eminem",
      "Kanye West", "Lil Wayne", "Cardi B", "A$AP Rocky", "Tyler, The Creator",
      "Doja Cat", "Megan Thee Stallion", "21 Savage", "Jay-Z", "Nas", "Snoop Dogg",
      "Missy Elliott", "Outkast", "Ice Spice", "50 Cent", "The Notorious B.I.G.",
      "2Pac", "Dr. Dre", "Lil Baby", "DaBaby", "Roddy Ricch", "Gunna",
      "Jack Harlow", "Latto", "GloRilla", "Rod Wave", "Polo G", "Lil Durk",
      "Moneybagg Yo", "Coi Leray",
    ],
  },
  drill: {
    label: "Drill",
    match: null, // Apple files drill under Hip-Hop/Rap — seeded only.
    seedArtists: [
      "Pop Smoke", "Central Cee", "Fivio Foreign", "Headie One", "Digga D",
      "Sheff G", "Kay Flock", "Russ Millions", "Unknown T", "Bandmanrill",
      "22Gz", "Lil Tjay", "Dusty Locane", "Set Da Trend", "Chief Keef",
      "King Von", "G Herbo",
    ],
  },
  trap: {
    label: "Trap",
    match: null, // Same storage problem as drill — seeded only.
    seedArtists: [
      "Future", "Young Thug", "Migos", "Gucci Mane", "Playboi Carti", "Lil Uzi Vert",
      "2 Chainz", "Metro Boomin", "Rae Sremmurd", "Offset", "Quavo", "Lil Yachty",
      "Yeat", "Ken Carson", "Don Toliver", "Young Jeezy", "T.I.", "Waka Flocka Flame",
    ],
  },
  "r&b": {
    label: "R&B",
    match: /r&b|soul|funk/i,
    seedArtists: [
      "SZA", "The Weeknd", "Beyoncé", "Frank Ocean", "H.E.R.", "Summer Walker",
      "Brent Faiyaz", "Chris Brown", "Usher", "Alicia Keys", "Jhené Aiko",
      "Daniel Caesar", "Giveon", "Victoria Monét", "Muni Long", "Rihanna",
      "Mariah Carey", "Whitney Houston", "Boyz II Men", "TLC", "Aaliyah",
    ],
  },
  pop: {
    label: "Pop",
    // The lookbehind keeps "K-Pop"/"J-Pop"/"Britpop" out of this family: only a
    // standalone "Pop" word (optionally prefixed by a space, as in "Indian
    // Pop"/"Dance Pop") counts.
    match: /(?<![a-z-])pop\b|singer\/songwriter/i,
    seedArtists: [
      "Taylor Swift", "Ariana Grande", "Dua Lipa", "Billie Eilish", "Ed Sheeran",
      "Sabrina Carpenter", "Olivia Rodrigo", "Harry Styles", "Bruno Mars",
      "Justin Bieber", "Katy Perry", "Lady Gaga", "Sia", "Charlie Puth",
      "Miley Cyrus", "Adele", "Chappell Roan", "Tate McRae", "Britney Spears",
      "Backstreet Boys", "NSYNC", "Madonna", "Maroon 5", "OneRepublic",
    ],
  },
  indie: {
    label: "Indie",
    match: /alternative|indie/i,
    seedArtists: [
      "Arctic Monkeys", "Tame Impala", "The 1975", "Radiohead", "Lana Del Rey",
      "Hozier", "Glass Animals", "Cage The Elephant", "Phoebe Bridgers",
      "Mitski", "The Strokes", "Vampire Weekend", "Beabadoobee", "Wallows",
      "MGMT", "Foster The People", "Two Door Cinema Club", "Clairo",
    ],
  },
  country: {
    label: "Country",
    match: /country|americana|bluegrass/i,
    seedArtists: [
      "Morgan Wallen", "Luke Combs", "Zach Bryan", "Chris Stapleton", "Jelly Roll",
      "Kacey Musgraves", "Carrie Underwood", "Blake Shelton", "Lainey Wilson",
      "Tyler Childers", "Johnny Cash", "Dolly Parton", "Shaboozey", "Post Malone",
      "Shania Twain", "Garth Brooks", "Keith Urban", "Tim McGraw",
    ],
  },
  // Bollywood + broader Indian film/pop. The matcher covers the regional labels
  // Apple actually uses (Hindi, Punjabi, Tamil, Telugu, …) and the seeds span
  // the 90s playback era through today's charts, so the decade filters work.
  bollywood: {
    label: "Bollywood",
    match: /bollywood|indian|hindi|tamil|telugu|punjabi|desi|devotional|ghazal|sufi/i,
    seedArtists: [
      "Arijit Singh", "A.R. Rahman", "Shreya Ghoshal", "Diljit Dosanjh",
      "Pritam", "Anirudh Ravichander", "Sid Sriram", "Karan Aujla", "AP Dhillon",
      "Atif Aslam", "Sonu Nigam", "Armaan Malik", "Neha Kakkar", "Badshah",
      "Yo Yo Honey Singh", "Jubin Nautiyal", "Darshan Raval", "Guru Randhawa",
      "Kumar Sanu", "Udit Narayan", "Alka Yagnik", "Kishore Kumar",
      "Lata Mangeshkar", "Mohit Chauhan", "KK", "Shaan", "Sunidhi Chauhan",
      "Rahat Fateh Ali Khan", "Vishal Mishra", "B Praak",
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

export function seedArtistsFor(key) {
  const fam = GENRE_FAMILIES[String(key ?? "").toLowerCase()];
  return fam ? fam.seedArtists.slice() : [];
}

export default GENRE_FAMILIES;

/**
 * Lightweight Australian suburb → (state, GRV location grade) lookup.
 *
 * Used by the Property Address input on section 1.1 Preliminary to auto-seed
 * the GRV sales-price benchmark when the user types an address. The benchmark
 * card still allows manual override on state / location grade — this is a
 * one-shot suggestion driven by the typed suburb.
 *
 * Coverage is intentionally narrow: a curated list of well-known capital-city
 * suburbs across NSW / VIC / QLD / WA / SA / ACT / TAS / NT. Unmapped suburbs
 * fall through and the user keeps the manually-picked grade.
 *
 * Maintenance: this is not exhaustive Australian gazetteer data. If a project
 * needs a suburb that isn't in the table, the user can either edit the
 * benchmark card directly or extend the table below.
 */
import type { LocationGrade, State } from './grvBenchmarks';

export interface SuburbEntry {
  suburb: string;        // canonical lowercase suburb name
  state: State;
  locationGrade: LocationGrade;
}

/**
 * Curated suburb table. Keys are lowercase suburb names; the lookup is
 * case-insensitive. When a suburb name is ambiguous across states (e.g.
 * "Richmond" exists in VIC, NSW and QLD), the highest-density / most likely
 * dev-context entry is used — the user can override on the benchmark card.
 */
const SUBURBS: SuburbEntry[] = [
  // ── NSW / Sydney ──────────────────────────────────────────────────────
  { suburb: 'sydney',          state: 'NSW', locationGrade: 'cbd' },
  { suburb: 'sydney cbd',      state: 'NSW', locationGrade: 'cbd' },
  { suburb: 'barangaroo',      state: 'NSW', locationGrade: 'cbd-prestige' },
  { suburb: 'point piper',     state: 'NSW', locationGrade: 'cbd-prestige' },
  { suburb: 'vaucluse',        state: 'NSW', locationGrade: 'cbd-prestige' },
  { suburb: 'double bay',      state: 'NSW', locationGrade: 'cbd-prestige' },
  { suburb: 'rose bay',        state: 'NSW', locationGrade: 'cbd-prestige' },
  { suburb: 'darling point',   state: 'NSW', locationGrade: 'cbd-prestige' },
  { suburb: 'mosman',          state: 'NSW', locationGrade: 'cbd-prestige' },
  { suburb: 'pyrmont',         state: 'NSW', locationGrade: 'cbd' },
  { suburb: 'darling harbour', state: 'NSW', locationGrade: 'cbd' },
  { suburb: 'haymarket',       state: 'NSW', locationGrade: 'cbd' },
  { suburb: 'ultimo',          state: 'NSW', locationGrade: 'cbd' },
  { suburb: 'surry hills',     state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'newtown',         state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'bondi',           state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'bondi beach',     state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'paddington',      state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'glebe',           state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'redfern',         state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'alexandria',      state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'waterloo',        state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'zetland',         state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'green square',    state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'mascot',          state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'chatswood',       state: 'NSW', locationGrade: 'middle-ring' },
  { suburb: 'parramatta',      state: 'NSW', locationGrade: 'middle-ring' },
  { suburb: 'north sydney',    state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'st leonards',     state: 'NSW', locationGrade: 'inner-ring' },
  { suburb: 'macquarie park',  state: 'NSW', locationGrade: 'middle-ring' },
  { suburb: 'hornsby',         state: 'NSW', locationGrade: 'middle-ring' },
  { suburb: 'epping',          state: 'NSW', locationGrade: 'middle-ring' },
  { suburb: 'penrith',         state: 'NSW', locationGrade: 'outer-ring' },
  { suburb: 'blacktown',       state: 'NSW', locationGrade: 'outer-ring' },
  { suburb: 'liverpool',       state: 'NSW', locationGrade: 'outer-ring' },
  { suburb: 'campbelltown',    state: 'NSW', locationGrade: 'outer-ring' },
  { suburb: 'newcastle',       state: 'NSW', locationGrade: 'regional' },
  { suburb: 'wollongong',      state: 'NSW', locationGrade: 'regional' },

  // ── VIC / Melbourne ───────────────────────────────────────────────────
  { suburb: 'melbourne',       state: 'VIC', locationGrade: 'cbd' },
  { suburb: 'melbourne cbd',   state: 'VIC', locationGrade: 'cbd' },
  { suburb: 'docklands',       state: 'VIC', locationGrade: 'cbd' },
  { suburb: 'southbank',       state: 'VIC', locationGrade: 'cbd' },
  { suburb: 'toorak',          state: 'VIC', locationGrade: 'cbd-prestige' },
  { suburb: 'south yarra',     state: 'VIC', locationGrade: 'cbd-prestige' },
  { suburb: 'east melbourne',  state: 'VIC', locationGrade: 'cbd-prestige' },
  { suburb: 'albert park',     state: 'VIC', locationGrade: 'cbd-prestige' },
  { suburb: 'middle park',     state: 'VIC', locationGrade: 'cbd-prestige' },
  { suburb: 'brighton',        state: 'VIC', locationGrade: 'cbd-prestige' },
  { suburb: 'kew',             state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'hawthorn',        state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'camberwell',      state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'carlton',         state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'fitzroy',         state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'collingwood',     state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'richmond',        state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'st kilda',        state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'brunswick',       state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'north melbourne', state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'west melbourne',  state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'prahran',         state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'windsor',         state: 'VIC', locationGrade: 'inner-ring' },
  { suburb: 'box hill',        state: 'VIC', locationGrade: 'middle-ring' },
  { suburb: 'glen waverley',   state: 'VIC', locationGrade: 'middle-ring' },
  { suburb: 'doncaster',       state: 'VIC', locationGrade: 'middle-ring' },
  { suburb: 'footscray',       state: 'VIC', locationGrade: 'middle-ring' },
  { suburb: 'preston',         state: 'VIC', locationGrade: 'middle-ring' },
  { suburb: 'coburg',          state: 'VIC', locationGrade: 'middle-ring' },
  { suburb: 'dandenong',       state: 'VIC', locationGrade: 'outer-ring' },
  { suburb: 'cranbourne',      state: 'VIC', locationGrade: 'outer-ring' },
  { suburb: 'werribee',        state: 'VIC', locationGrade: 'outer-ring' },
  { suburb: 'frankston',       state: 'VIC', locationGrade: 'outer-ring' },
  { suburb: 'pakenham',        state: 'VIC', locationGrade: 'outer-ring' },
  { suburb: 'geelong',         state: 'VIC', locationGrade: 'regional' },
  { suburb: 'ballarat',        state: 'VIC', locationGrade: 'regional' },
  { suburb: 'bendigo',         state: 'VIC', locationGrade: 'regional' },

  // ── QLD / Brisbane + Gold Coast ───────────────────────────────────────
  { suburb: 'brisbane',        state: 'QLD', locationGrade: 'cbd' },
  { suburb: 'brisbane cbd',    state: 'QLD', locationGrade: 'cbd' },
  { suburb: 'fortitude valley',state: 'QLD', locationGrade: 'cbd' },
  { suburb: 'south brisbane',  state: 'QLD', locationGrade: 'cbd' },
  { suburb: 'new farm',        state: 'QLD', locationGrade: 'cbd-prestige' },
  { suburb: 'hamilton',        state: 'QLD', locationGrade: 'cbd-prestige' },
  { suburb: 'ascot',           state: 'QLD', locationGrade: 'cbd-prestige' },
  { suburb: 'teneriffe',       state: 'QLD', locationGrade: 'cbd-prestige' },
  { suburb: 'bulimba',         state: 'QLD', locationGrade: 'cbd-prestige' },
  { suburb: 'west end',        state: 'QLD', locationGrade: 'inner-ring' },
  { suburb: 'paddington',      state: 'QLD', locationGrade: 'inner-ring' },
  { suburb: 'toowong',         state: 'QLD', locationGrade: 'inner-ring' },
  { suburb: 'st lucia',        state: 'QLD', locationGrade: 'inner-ring' },
  { suburb: 'kelvin grove',    state: 'QLD', locationGrade: 'inner-ring' },
  { suburb: 'newstead',        state: 'QLD', locationGrade: 'inner-ring' },
  { suburb: 'spring hill',     state: 'QLD', locationGrade: 'inner-ring' },
  { suburb: 'indooroopilly',   state: 'QLD', locationGrade: 'middle-ring' },
  { suburb: 'carindale',       state: 'QLD', locationGrade: 'middle-ring' },
  { suburb: 'chermside',       state: 'QLD', locationGrade: 'middle-ring' },
  { suburb: 'logan',           state: 'QLD', locationGrade: 'outer-ring' },
  { suburb: 'logan central',   state: 'QLD', locationGrade: 'outer-ring' },
  { suburb: 'ipswich',         state: 'QLD', locationGrade: 'outer-ring' },
  { suburb: 'caboolture',      state: 'QLD', locationGrade: 'outer-ring' },
  { suburb: 'redbank',         state: 'QLD', locationGrade: 'outer-ring' },
  { suburb: 'gold coast',      state: 'QLD', locationGrade: 'regional' },
  { suburb: 'surfers paradise',state: 'QLD', locationGrade: 'cbd-prestige' },
  { suburb: 'broadbeach',      state: 'QLD', locationGrade: 'cbd-prestige' },
  { suburb: 'main beach',      state: 'QLD', locationGrade: 'cbd-prestige' },
  { suburb: 'southport',       state: 'QLD', locationGrade: 'inner-ring' },
  { suburb: 'robina',          state: 'QLD', locationGrade: 'middle-ring' },
  { suburb: 'cairns',          state: 'QLD', locationGrade: 'regional' },
  { suburb: 'townsville',      state: 'QLD', locationGrade: 'regional' },
  { suburb: 'sunshine coast',  state: 'QLD', locationGrade: 'regional' },
  { suburb: 'noosa',           state: 'QLD', locationGrade: 'cbd-prestige' },

  // ── WA / Perth ────────────────────────────────────────────────────────
  { suburb: 'perth',           state: 'WA',  locationGrade: 'cbd' },
  { suburb: 'perth cbd',       state: 'WA',  locationGrade: 'cbd' },
  { suburb: 'east perth',      state: 'WA',  locationGrade: 'cbd' },
  { suburb: 'west perth',      state: 'WA',  locationGrade: 'cbd' },
  { suburb: 'cottesloe',       state: 'WA',  locationGrade: 'cbd-prestige' },
  { suburb: 'claremont',       state: 'WA',  locationGrade: 'cbd-prestige' },
  { suburb: 'peppermint grove',state: 'WA',  locationGrade: 'cbd-prestige' },
  { suburb: 'dalkeith',        state: 'WA',  locationGrade: 'cbd-prestige' },
  { suburb: 'subiaco',         state: 'WA',  locationGrade: 'inner-ring' },
  { suburb: 'leederville',     state: 'WA',  locationGrade: 'inner-ring' },
  { suburb: 'mount lawley',    state: 'WA',  locationGrade: 'inner-ring' },
  { suburb: 'fremantle',       state: 'WA',  locationGrade: 'inner-ring' },
  { suburb: 'joondalup',       state: 'WA',  locationGrade: 'middle-ring' },
  { suburb: 'cannington',      state: 'WA',  locationGrade: 'middle-ring' },
  { suburb: 'armadale',        state: 'WA',  locationGrade: 'outer-ring' },
  { suburb: 'rockingham',      state: 'WA',  locationGrade: 'outer-ring' },
  { suburb: 'mandurah',        state: 'WA',  locationGrade: 'outer-ring' },

  // ── SA / Adelaide ─────────────────────────────────────────────────────
  { suburb: 'adelaide',        state: 'SA',  locationGrade: 'cbd' },
  { suburb: 'adelaide cbd',    state: 'SA',  locationGrade: 'cbd' },
  { suburb: 'north adelaide',  state: 'SA',  locationGrade: 'cbd-prestige' },
  { suburb: 'norwood',         state: 'SA',  locationGrade: 'inner-ring' },
  { suburb: 'glenelg',         state: 'SA',  locationGrade: 'inner-ring' },
  { suburb: 'unley',           state: 'SA',  locationGrade: 'inner-ring' },
  { suburb: 'burnside',        state: 'SA',  locationGrade: 'inner-ring' },
  { suburb: 'marion',          state: 'SA',  locationGrade: 'middle-ring' },
  { suburb: 'salisbury',       state: 'SA',  locationGrade: 'outer-ring' },
  { suburb: 'elizabeth',       state: 'SA',  locationGrade: 'outer-ring' },

  // ── ACT / Canberra ────────────────────────────────────────────────────
  { suburb: 'canberra',        state: 'ACT', locationGrade: 'cbd' },
  { suburb: 'canberra cbd',    state: 'ACT', locationGrade: 'cbd' },
  { suburb: 'civic',           state: 'ACT', locationGrade: 'cbd' },
  { suburb: 'forrest',         state: 'ACT', locationGrade: 'cbd-prestige' },
  { suburb: 'red hill',        state: 'ACT', locationGrade: 'cbd-prestige' },
  { suburb: 'yarralumla',      state: 'ACT', locationGrade: 'cbd-prestige' },
  { suburb: 'barton',          state: 'ACT', locationGrade: 'cbd' },
  { suburb: 'kingston',        state: 'ACT', locationGrade: 'inner-ring' },
  { suburb: 'braddon',         state: 'ACT', locationGrade: 'inner-ring' },
  { suburb: 'belconnen',       state: 'ACT', locationGrade: 'middle-ring' },
  { suburb: 'gungahlin',       state: 'ACT', locationGrade: 'middle-ring' },
  { suburb: 'tuggeranong',     state: 'ACT', locationGrade: 'outer-ring' },

  // ── TAS / Hobart ──────────────────────────────────────────────────────
  { suburb: 'hobart',          state: 'TAS', locationGrade: 'cbd' },
  { suburb: 'sandy bay',       state: 'TAS', locationGrade: 'cbd-prestige' },
  { suburb: 'battery point',   state: 'TAS', locationGrade: 'cbd-prestige' },
  { suburb: 'launceston',      state: 'TAS', locationGrade: 'regional' },

  // ── NT / Darwin ───────────────────────────────────────────────────────
  { suburb: 'darwin',          state: 'NT',  locationGrade: 'cbd' },
  { suburb: 'darwin cbd',      state: 'NT',  locationGrade: 'cbd' },
  { suburb: 'larrakeyah',      state: 'NT',  locationGrade: 'cbd-prestige' },
  { suburb: 'nightcliff',      state: 'NT',  locationGrade: 'inner-ring' },
  { suburb: 'palmerston',      state: 'NT',  locationGrade: 'outer-ring' },
  { suburb: 'alice springs',   state: 'NT',  locationGrade: 'regional' },
];

// Per-suburb candidate list: a suburb name can map to multiple entries when
// it collides across states (e.g. "Paddington" exists in both NSW and QLD,
// "Richmond" in VIC / NSW / QLD). Disambiguation uses state/postcode tokens
// in the address — see lookupSuburb below.
const SUBURB_INDEX: Map<string, SuburbEntry[]> = (() => {
  const m = new Map<string, SuburbEntry[]>();
  for (const entry of SUBURBS) {
    const list = m.get(entry.suburb);
    if (list) list.push(entry);
    else m.set(entry.suburb, [entry]);
  }
  return m;
})();

const STATE_TOKENS: ReadonlyArray<State> = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'ACT', 'TAS', 'NT'];

/**
 * Australian postcode → state mapping (high-level ranges, sufficient for
 * disambiguating collided suburb names like "Paddington 2021" (NSW) vs
 * "Paddington 4064" (QLD)). Source: Australia Post postcode ranges.
 */
function stateFromPostcode(pc: string): State | null {
  const n = parseInt(pc, 10);
  if (!Number.isFinite(n) || pc.length !== 4) return null;
  if (n >= 1000 && n <= 2599) return 'NSW';
  if (n >= 2619 && n <= 2899) return 'NSW';
  if (n >= 2921 && n <= 2999) return 'NSW';
  if (n >= 200 && n <= 299) return 'ACT';
  if (n >= 2600 && n <= 2618) return 'ACT';
  if (n >= 2900 && n <= 2920) return 'ACT';
  if (n >= 3000 && n <= 3999) return 'VIC';
  if (n >= 8000 && n <= 8999) return 'VIC';
  if (n >= 4000 && n <= 4999) return 'QLD';
  if (n >= 9000 && n <= 9999) return 'QLD';
  if (n >= 5000 && n <= 5799) return 'SA';
  if (n >= 5800 && n <= 5999) return 'SA';
  if (n >= 6000 && n <= 6797) return 'WA';
  if (n >= 6800 && n <= 6999) return 'WA';
  if (n >= 7000 && n <= 7799) return 'TAS';
  if (n >= 7800 && n <= 7999) return 'TAS';
  if (n >= 800 && n <= 899) return 'NT';
  if (n >= 900 && n <= 999) return 'NT';
  return null;
}

/**
 * Parse the locality segment from a free-text Australian address. AU
 * conventions place the suburb just before the state abbreviation and
 * postcode (e.g. "123 High Street, Kew VIC 3101"). We isolate the segment
 * after the last comma (if any) up to the state/postcode token, and fall
 * back to the slice immediately preceding the state token.
 */
function extractLocality(norm: string): { locality: string; state: State | null; postcode: string | null } {
  const tokens = norm.trim().split(/\s+/);
  let stateIdx = -1;
  let foundState: State | null = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (!tok) continue;
    const up = tok.toUpperCase() as State;
    if (STATE_TOKENS.includes(up)) {
      stateIdx = i;
      foundState = up;
      break;
    }
  }
  // Postcode search — Australian postcodes ALWAYS come after the state
  // token ("Kew VIC 3101"). If we found a state token, restrict the search
  // to indices after it; otherwise scan the whole address from the end and
  // take the last 4-digit token (handles postcode-only inputs like
  // "Paddington 4064"). This prevents a LEADING 4-digit street number
  // (e.g. "2026 Bondi Road, Bondi NSW") from being mis-read as the
  // postcode, which would collapse the locality slice to empty and miss
  // the otherwise-valid suburb match.
  let postcode: string | null = null;
  let postcodeIdx = -1;
  const postcodeMinIdx = stateIdx >= 0 ? stateIdx + 1 : 0;
  for (let i = tokens.length - 1; i >= postcodeMinIdx; i--) {
    const tok = tokens[i];
    if (tok && /^\d{4}$/.test(tok)) { postcode = tok; postcodeIdx = i; break; }
  }
  // Locality boundary = the LEFTMOST of (state token, postcode token).
  // Everything before that boundary is the candidate locality slice; the
  // suburb must appear at the END of that slice (AU convention: suburb
  // immediately precedes state/postcode), which eliminates the street-name
  // false-positive class.
  let boundary = -1;
  if (stateIdx >= 0 && postcodeIdx >= 0) boundary = Math.min(stateIdx, postcodeIdx);
  else if (stateIdx >= 0) boundary = stateIdx;
  else if (postcodeIdx >= 0) boundary = postcodeIdx;
  const locality = boundary > 0 ? ` ${tokens.slice(0, boundary).join(' ')} ` : norm;
  return { locality, state: foundState, postcode };
}

/**
 * Try to find a suburb in the lookup table from a free-text Australian
 * address. Strategy:
 *
 * 1. Parse the address into tokens; find the state abbreviation and
 *    postcode (if present).
 * 2. Restrict suburb matching to the LOCALITY segment (the tokens BEFORE
 *    the state token) and require the suburb to appear at the end of that
 *    segment — this prevents a street/building name that happens to contain
 *    a known suburb word (e.g. "1 Newtown Road, Some Other Suburb NSW")
 *    from being misclassified as that suburb.
 * 3. If the suburb name is ambiguous across states (e.g. "Paddington"),
 *    use the state token and postcode-derived state to pick the right
 *    entry; otherwise fall back to the first listed entry.
 * 4. If no state/postcode is present in the address, fall back to a
 *    looser locality-anywhere match so casual inputs ("Bondi Beach") still
 *    auto-seed.
 */
export function lookupSuburb(address: string | undefined | null): SuburbEntry | null {
  if (!address) return null;
  const norm = ` ${address.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const { locality, state: stateTok, postcode } = extractLocality(norm);
  const stateFromPC = postcode ? stateFromPostcode(postcode) : null;
  const targetState: State | null = stateTok ?? stateFromPC;

  // Candidate suburbs sorted longest-first so multi-word names ("Surfers
  // Paradise", "Glen Waverley") beat single-word prefixes/substrings.
  const candidates = Array.from(SUBURB_INDEX.keys()).sort((a, b) => b.length - a.length);

  const pickEntry = (entries: SuburbEntry[]): SuburbEntry | null => {
    if (entries.length === 0) return null;
    if (targetState) {
      const match = entries.find(e => e.state === targetState);
      if (match) return match;
    }
    return entries[0] ?? null;
  };

  // Pass 1: strict — suburb must appear at the END of the locality segment
  // (immediately before the state/postcode). This is the AU convention and
  // eliminates the street-name false-positive class.
  if (stateTok || stateFromPC) {
    for (const key of candidates) {
      if (locality.endsWith(` ${key} `)) {
        const entries = SUBURB_INDEX.get(key)!;
        return pickEntry(entries);
      }
    }
  }

  // Pass 2: looser — when there's no state/postcode at all, allow a
  // locality-anywhere match so casual inputs still seed something.
  if (!stateTok && !stateFromPC) {
    for (const key of candidates) {
      if (norm.includes(` ${key} `)) {
        const entries = SUBURB_INDEX.get(key)!;
        return pickEntry(entries);
      }
    }
  }

  return null;
}

/** Exposed for unit tests / dev tooling. */
export const __suburbTableForTests = SUBURBS;
export const __stateFromPostcodeForTests = stateFromPostcode;

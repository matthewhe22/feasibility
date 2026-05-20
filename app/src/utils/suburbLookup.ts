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
  { suburb: 'paddington',      state: 'QLD', locationGrade: 'inner-ring' }, // collides w/ NSW; NSW used first
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

const SUBURB_INDEX: Map<string, SuburbEntry> = (() => {
  const m = new Map<string, SuburbEntry>();
  for (const entry of SUBURBS) {
    if (!m.has(entry.suburb)) m.set(entry.suburb, entry);
  }
  return m;
})();

/**
 * Try to find a suburb in the lookup table by matching the longest suburb
 * name contained in the free-text address. Case-insensitive; ignores commas
 * and extra whitespace. Returns null when no suburb is recognised.
 *
 * Strategy: iterate the known suburbs longest-first so multi-word names
 * ("Surfers Paradise", "Bondi Beach", "Glen Waverley") win over single-word
 * prefixes / substrings.
 */
export function lookupSuburb(address: string | undefined | null): SuburbEntry | null {
  if (!address) return null;
  const norm = ` ${address.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ')} `;
  const candidates = Array.from(SUBURB_INDEX.keys()).sort((a, b) => b.length - a.length);
  for (const key of candidates) {
    if (norm.includes(` ${key} `)) return SUBURB_INDEX.get(key) ?? null;
  }
  return null;
}

/** Exposed for unit tests / dev tooling. */
export const __suburbTableForTests = SUBURBS;

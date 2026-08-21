export type Mode = 'sword' | 'axe' | 'nethpot' | 'dpot' | 'uhc' | 'smp' | 'crystal' | 'mace';
export type Region = 'AS' | 'EU' | 'NA' | 'AU' | 'SA' | 'ME';
export type Tier = 'HT1' | 'LT1' | 'HT2' | 'LT2' | 'HT3' | 'LT3' | 'HT4' | 'LT4' | 'HT5' | 'LT5' | 'Unranked';
export type QueueStatus = 'WAITING' | 'CLAIMED';
export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'CANCELLED';

export const Mode = {
  sword: 'sword',
  axe: 'axe',
  nethpot: 'nethpot',
  dpot: 'dpot',
  uhc: 'uhc',
  smp: 'smp',
  crystal: 'crystal',
  mace: 'mace',
} as const;

export const Region = {
  AS: 'AS',
  EU: 'EU',
  NA: 'NA',
  AU: 'AU',
  SA: 'SA',
  ME: 'ME',
} as const;

export const QueueStatus = {
  WAITING: 'WAITING',
  CLAIMED: 'CLAIMED',
} as const;

export const SessionStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
} as const;

export const VerificationStatus = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export const MODES: Record<Mode, string> = {
  sword: 'Sword',
  axe: 'Axe',
  nethpot: 'Netherite Pot',
  dpot: 'Diamond Pot',
  uhc: 'UHC',
  smp: 'SMP',
  crystal: 'Crystal',
  mace: 'Mace',
};

export const REGIONS: Record<Region, string> = {
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  AU: 'Australia',
  SA: 'South America',
  ME: 'Middle East',
};

export const TIERS: Tier[] = [
  'HT1', 'LT1',
  'HT2', 'LT2',
  'HT3', 'LT3',
  'HT4', 'LT4',
  'HT5', 'LT5',
  'Unranked',
];

export const TIER_ORDER: Record<Tier, number> = {
  HT1: 1, LT1: 2,
  HT2: 3, LT2: 4,
  HT3: 5, LT3: 6,
  HT4: 7, LT4: 8,
  HT5: 9, LT5: 10,
  Unranked: 11,
};

export const TIER_COLORS: Record<string, string> = {
  HT1: '#FF0000',
  LT1: '#FF4444',
  HT2: '#FF8800',
  LT2: '#FFAA44',
  HT3: '#FFFF00',
  LT3: '#FFFF77',
  HT4: '#00FF00',
  LT4: '#77FF77',
  HT5: '#00FFFF',
  LT5: '#77FFFF',
  Unranked: '#95A5A6',
};

export const MODE_LIST = Object.keys(MODES) as Mode[];
export const REGION_LIST = Object.keys(REGIONS) as Region[];

export const COLORS = {
  PRIMARY: 0x5865F2,
  SUCCESS: 0x57F287,
  WARNING: 0xFEE75C,
  DANGER: 0xED4245,
  TIER_TEST: 0x2B2D31,
  RESULT: 0xFFD700,
};

export const MINECRAFT_API_URL = 'https://api.mojang.com';

export const QUEUE_LOCK_TIMEOUT_MS = 30_000; // 30 seconds

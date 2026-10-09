/** A seeded source of uniform numbers in `[0, 1)`. */
export type Rng = () => number;

/** 32-bit FNV-1a hash of a string. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // eslint-disable-next-line no-bitwise
  return hash >>> 0;
}

/** Mulberry32, seeded from every key given, so equal keys always replay the same sequence. */
export function createRng(...keys: (string | number)[]): Rng {
  let state = hashString(keys.join('\u0000'));
  return () => {
    /* eslint-disable no-bitwise */
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    /* eslint-enable no-bitwise */
  };
}

/** Whether an event of probability `p` happens. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** A uniform integer in `[min, max]`. */
export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** A version-4-shaped UUID drawn from `rng`. */
export function uuid(rng: Rng): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16));
  hex[12] = '4';
  hex[16] = (8 + Math.floor(rng() * 4)).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

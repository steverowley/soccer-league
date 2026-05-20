export const rnd = (min: number, max: number): number =>
  Math.random() * (max - min) + min;
export const rndI = (min: number, max: number): number =>
  Math.floor(rnd(min, max + 1));
export const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)] as T;

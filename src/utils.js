export const rnd  = (min, max) => Math.random() * (max - min) + min;
export const rndI = (min, max) => Math.floor(rnd(min, max + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

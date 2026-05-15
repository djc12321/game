import type { Difficulty } from './constants';

export interface SaveData {
  highestLevel: number;
  difficulty: Difficulty;
  soundEnabled: boolean;
  bestScores: Record<number, number>; // level -> best score
}

const KEY = 'midnight-phone-save';

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSave(), ...JSON.parse(raw) };
  } catch {}
  return defaultSave();
}

export function saveData(data: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

export function defaultSave(): SaveData {
  return { highestLevel: 1, difficulty: 'normal', soundEnabled: true, bestScores: {} };
}

export function fmtTime(s: number): string {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function rand(a: number, b: number) { return a + Math.random() * (b - a); }
export function randInt(a: number, b: number) { return Math.floor(rand(a, b + 1)); }

export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

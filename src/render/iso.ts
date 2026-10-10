/**
 * 等距投影与坐标变换
 */

export const TILE_W = 64;
export const TILE_H = 32;
export const ELEV_H = 9; // 每级海拔的像素抬升

export interface Point { x: number; y: number }

/** 网格 → 屏幕（世界像素坐标，未含摄像机） */
export function gridToScreen(x: number, y: number): Point {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

/** 世界像素 → 网格（浮点） */
export function screenToGrid(sx: number, sy: number): Point {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** 网格 → 屏幕中心点（含海拔抬升） */
export function tileCenter(x: number, y: number, elevation = 0): Point {
  const p = gridToScreen(x, y);
  return { x: p.x, y: p.y - elevation * ELEV_H };
}

/** 地图中心的世界像素（用于摄像机默认位置） */
export function mapCenterPx(size: number): Point {
  return { x: 0, y: size * TILE_H / 2 };
}

/** 确定性小哈希（颜色抖动等视觉用途，不影响模拟） */
export function vhash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

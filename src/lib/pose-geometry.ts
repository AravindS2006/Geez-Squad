export type Point = { x: number; y: number; z?: number };

export function jointAngle(a: Point, b: Point, c: Point): number | null {
  const ux = a.x - b.x,
    uy = a.y - b.y,
    uz = (a.z ?? 0) - (b.z ?? 0),
    vx = c.x - b.x,
    vy = c.y - b.y,
    vz = (c.z ?? 0) - (b.z ?? 0);
  const denominator = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  if (!Number.isFinite(denominator) || denominator < 0.0001) return null;
  return (
    (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / denominator))) * 180) /
    Math.PI
  );
}

import { jointAngle, type Point } from './pose-geometry';
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function analyzePoseForm(
  kind: string,
  point: (index: number) => Point,
  geometryPoint = point,
  reference: Point | null = null,
  options: { bodyLineJoint?: 25 | 27; maxBodySlopeDeg?: number } = {},
): { score: number | null; valid: boolean; cue: string | null; postureValid?: boolean } {
  const lineJoint = kind === 'pushup' ? (options.bodyLineJoint ?? 27) : 27;
  const maxSlope = kind === 'pushup' ? (options.maxBodySlopeDeg ?? 55) : 55;
  const shoulder = point(11),
    hip = point(23),
    ankle = point(lineJoint);
  const verticalLean =
    (Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180) / Math.PI;
  const slope = Math.abs((Math.atan2(ankle.y - shoulder.y, ankle.x - shoulder.x) * 180) / Math.PI);
  const flat = Math.min(slope, 180 - slope);
  const alignment = jointAngle(geometryPoint(11), geometryPoint(23), geometryPoint(lineJoint));
  if (kind === 'pushup' || kind === 'plank' || kind === 'sideplank') {
    const valid = flat <= maxSlope && alignment !== null && alignment >= 140;
    const score = alignment === null ? 0 : clamp(100 - Math.max(0, 175 - alignment) * 2);
    return {
      score,
      valid,
      cue:
        flat > maxSlope
          ? 'Move into a side-on push-up position: hands below shoulders, legs extended.'
          : alignment === null || alignment < 155
            ? lineJoint === 25
              ? 'Keep shoulders, hips, and knees in a steadier line.'
              : 'Keep shoulders, hips, and ankles in a steadier line.'
            : null,
    };
  }
  if (kind === 'curl') {
    // Compare anatomical vectors, not unsigned screen slopes. The old slope
    // treated an upward arm like a downward arm, penalized camera roll, and
    // completely missed shoulder flexion toward a front-facing camera.
    const upperArmLean = jointAngle(geometryPoint(23), geometryPoint(11), geometryPoint(13));
    const gs = geometryPoint(11),
      gh = geometryPoint(23);
    const torsoChange = reference
      ? (jointAngle(
          reference,
          { x: 0, y: 0, z: 0 },
          { x: gs.x - gh.x, y: gs.y - gh.y, z: (gs.z ?? 0) - (gh.z ?? 0) },
        ) ?? 0)
      : 0;
    const score =
      upperArmLean === null
        ? null
        : clamp(95 - Math.max(0, upperArmLean - 20) * 1.5 - Math.max(0, torsoChange - 10) * 1.5);
    return {
      score,
      postureValid:
        upperArmLean !== null && upperArmLean < 100 && verticalLean <= 55 && shoulder.y < hip.y,
      valid:
        upperArmLean !== null && upperArmLean <= 65 && verticalLean <= 55 && shoulder.y < hip.y,
      cue:
        upperArmLean === null
          ? 'Keep your shoulder, elbow, and hip clearly visible.'
          : upperArmLean > 35
            ? 'Keep your upper arm steadier and reduce the weight if needed.'
            : torsoChange > 20 || verticalLean > 55 || shoulder.y >= hip.y
              ? 'Keep your torso steady as you curl.'
              : null,
    };
  }
  if (kind === 'squat' || kind === 'lunge')
    return {
      score: clamp(95 - Math.max(0, verticalLean - 45) * 1.3),
      valid: verticalLean < 80,
      cue:
        verticalLean > 60 ? 'Check your trunk position with your coach before continuing.' : null,
    };
  if (
    kind === 'lateralraise' ||
    kind === 'frontraise' ||
    kind === 'press' ||
    kind === 'jumpingjack' ||
    kind === 'stepjack'
  ) {
    const wrist = point(15);
    const elbow = point(13);
    const aboveShoulder =
      kind !== 'press' || wrist.y < shoulder.y + Math.abs(hip.y - shoulder.y) * 0.15;
    return {
      score: clamp(95 - Math.max(0, verticalLean - 20) * 1.5),
      valid: verticalLean < 50 && aboveShoulder,
      cue: !aboveShoulder
        ? 'Start with your hands near shoulder height, then press upward.'
        : verticalLean > 30
          ? 'Keep your torso tall and steady.'
          : (kind === 'lateralraise' || kind === 'frontraise') &&
              elbow.y < shoulder.y - Math.abs(hip.y - shoulder.y) * 0.15
            ? 'Raise only to your coach-approved shoulder height.'
            : null,
    };
  }
  if (kind === 'bridge' || kind === 'crunch')
    return {
      // This posture gate does not measure spinal position, pelvic control or
      // technique. A constant 90 falsely represented those as measured quality.
      score: null,
      valid:
        flat < 65 &&
        verticalLean > 35 &&
        shoulder.y >= ankle.y - Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) * 0.65,
      cue:
        flat >= 65 ||
        verticalLean <= 35 ||
        shoulder.y < ankle.y - Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) * 0.65
          ? 'Lie side-on with shoulders, hips, and feet visible before starting.'
          : null,
    };
  if (kind === 'row')
    return {
      score: null,
      valid: verticalLean >= 20 && verticalLean < 90,
      cue:
        verticalLean < 20 ? 'Hinge at your hips and keep your trunk steady before rowing.' : null,
    };
  if (kind === 'hinge') {
    // A hinge keeps the knees softly bent. Deep knee flexion means a squat,
    // which this profile's hip signal would otherwise count as a hinge.
    const knee = jointAngle(geometryPoint(23), geometryPoint(25), geometryPoint(27));
    const valid = knee !== null && knee >= 135;
    return {
      score: null,
      valid,
      cue: valid ? null : 'Keep your knees softly bent and push your hips back, not down.',
    };
  }
  if (kind === 'overhead') {
    const upperArm = jointAngle(geometryPoint(23), geometryPoint(11), geometryPoint(13));
    const valid = upperArm !== null && upperArm >= 130 && verticalLean < 30;
    return {
      score: upperArm === null ? null : clamp(95 - Math.max(0, 160 - upperArm) * 1.5),
      valid,
      cue:
        upperArm === null || upperArm < 130
          ? 'Keep your elbows pointing up beside your head.'
          : verticalLean >= 30
            ? 'Keep your torso tall and steady.'
            : null,
    };
  }
  if (kind === 'bandrow' || kind === 'wallsit' || kind === 'highknees') {
    const limit = kind === 'highknees' ? 30 : 25;
    return {
      score: null,
      valid: verticalLean < limit,
      cue:
        verticalLean < limit
          ? null
          : kind === 'wallsit'
            ? 'Keep your back flat against the wall.'
            : 'Keep your trunk upright.',
    };
  }
  return { score: null, valid: false, cue: null };
}

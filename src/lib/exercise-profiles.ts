export type ExerciseProfile = {
  name: string;
  category: string;
  joints: number[];
  signal: 'knee' | 'elbow' | 'body' | 'shoulder' | 'hip';
  direction: 'decrease' | 'increase';
  view: 'side' | 'front' | 'either';
  form:
    | 'squat'
    | 'pushup'
    | 'curl'
    | 'plank'
    | 'lunge'
    | 'press'
    | 'lateralraise'
    | 'jumpingjack'
    | 'bridge'
    | 'crunch'
    | 'row'
    | 'sideplank';
  bilateral: boolean;
  isHold: boolean;
  topAngle: number;
  bottomAngle: number;
  minimumRom: number;
  hysteresis: number;
  minRepMs: number;
  maxRepMs: number;
  cooldownMs: number;
  occlusionGraceMs: number;
  startCue: string;
  moveCue: string;
  returnCue: string;
  cameraCue: string;
};

const profile = (
  input: Omit<ExerciseProfile, 'hysteresis' | 'maxRepMs' | 'cooldownMs' | 'occlusionGraceMs'>,
): ExerciseProfile => ({
  hysteresis: 6,
  maxRepMs: 15000,
  cooldownMs: 250,
  occlusionGraceMs: 450,
  ...input,
});

// Endpoints are raw degrees: topAngle is the higher endpoint, bottomAngle the lower.
// Direction selects whether a repetition starts at the high or low endpoint.
export const exerciseProfiles = {
  squat: profile({
    name: 'Bodyweight squat',
    category: 'Lower body',
    joints: [11, 23, 25, 27],
    signal: 'knee',
    direction: 'decrease',
    view: 'side',
    form: 'squat',
    bilateral: false,
    isHold: false,
    topAngle: 155,
    bottomAngle: 112,
    minimumRom: 35,
    minRepMs: 600,
    startCue: 'Stand tall with your feet about shoulder-width apart.',
    moveCue: 'Bend hips and knees, sitting back within your comfortable range.',
    returnCue: 'Press through your feet and return to standing.',
    cameraCue: 'Side view · shoulder, hip, knee, and ankle visible',
  }),
  pushup: profile({
    name: 'Push-up',
    category: 'Upper body',
    joints: [11, 13, 15, 23, 27],
    signal: 'elbow',
    direction: 'decrease',
    view: 'side',
    form: 'pushup',
    bilateral: false,
    isHold: false,
    topAngle: 150,
    bottomAngle: 105,
    minimumRom: 35,
    minRepMs: 550,
    startCue: 'Start with arms extended and your body in a straight line.',
    moveCue: 'Bend your elbows to lower your chest under control.',
    returnCue: 'Press back to your extended starting position.',
    cameraCue: 'Side view · shoulder, elbow, wrist, hip, and ankle visible',
  }),
  curl: profile({
    name: 'Biceps curl',
    category: 'Upper body',
    joints: [11, 13, 15, 23],
    signal: 'elbow',
    direction: 'decrease',
    view: 'either',
    form: 'curl',
    bilateral: false,
    isHold: false,
    topAngle: 145,
    bottomAngle: 85,
    minimumRom: 45,
    minRepMs: 450,
    startCue: 'Stand tall with your working arm comfortably extended.',
    moveCue: 'Curl toward your shoulder while keeping your upper arm steady.',
    returnCue: 'Lower under control to your starting position.',
    cameraCue: 'Front or slight side view · shoulder, elbow, wrist, and hip visible',
  }),
  plank: profile({
    name: 'Plank',
    category: 'Core',
    joints: [11, 23, 27],
    signal: 'body',
    direction: 'decrease',
    view: 'side',
    form: 'plank',
    bilateral: false,
    isHold: true,
    topAngle: 160,
    bottomAngle: 135,
    minimumRom: 0,
    minRepMs: 600,
    startCue: 'Hold a side-on plank with shoulders, hips, and ankles aligned.',
    moveCue: 'Hold steady and breathe comfortably.',
    returnCue: 'Rest when the set is complete.',
    cameraCue: 'Side view · whole body visible',
  }),
  lunge: profile({
    name: 'Stationary lunge',
    category: 'Lower body',
    joints: [11, 23, 25, 27],
    signal: 'knee',
    direction: 'decrease',
    view: 'side',
    form: 'lunge',
    bilateral: false,
    isHold: false,
    topAngle: 155,
    bottomAngle: 110,
    minimumRom: 35,
    minRepMs: 600,
    startCue: 'Take a split stance with the tracked leg forward and stand tall.',
    moveCue: 'Bend both knees and lower within your comfortable range.',
    returnCue: 'Press through the front foot and return to the split stance.',
    cameraCue: 'Side view · select the forward leg; repeat the set for the other side',
  }),
  shoulderpress: profile({
    name: 'Shoulder press',
    category: 'Upper body',
    joints: [11, 13, 15, 23],
    signal: 'elbow',
    direction: 'increase',
    view: 'either',
    form: 'press',
    bilateral: false,
    isHold: false,
    topAngle: 155,
    bottomAngle: 95,
    minimumRom: 45,
    minRepMs: 500,
    startCue: 'Stand tall with elbows bent and hands near shoulder height.',
    moveCue: 'Press your hands upward, keeping your trunk steady.',
    returnCue: 'Lower slowly to shoulder height.',
    cameraCue: 'Front or slight side view · shoulders, elbows, wrists, and hips visible',
  }),
  lateralraise: profile({
    name: 'Lateral raise',
    category: 'Upper body',
    joints: [11, 13, 15, 23],
    signal: 'shoulder',
    direction: 'increase',
    view: 'front',
    form: 'lateralraise',
    bilateral: false,
    isHold: false,
    topAngle: 80,
    bottomAngle: 20,
    minimumRom: 45,
    minRepMs: 500,
    startCue: 'Stand tall with your arms beside your body.',
    moveCue: 'Raise your arms out to the sides to about shoulder height.',
    returnCue: 'Lower your arms slowly to your sides.',
    cameraCue: 'Front view · arms and hips visible',
  }),
  jumpingjack: profile({
    name: 'Jumping jack',
    category: 'Conditioning',
    joints: [11, 13, 15, 23, 25, 27],
    signal: 'shoulder',
    direction: 'increase',
    view: 'front',
    form: 'jumpingjack',
    bilateral: true,
    isHold: false,
    topAngle: 140,
    bottomAngle: 25,
    minimumRom: 80,
    minRepMs: 400,
    startCue: 'Stand with feet together and arms by your sides.',
    moveCue: 'Open your feet while raising both arms overhead.',
    returnCue: 'Bring feet together and lower both arms to complete the rep.',
    cameraCue: 'Front view · both hands and feet fully visible',
  }),
  glutebridge: profile({
    name: 'Glute bridge',
    category: 'Lower body',
    joints: [11, 23, 25, 27],
    signal: 'hip',
    direction: 'increase',
    view: 'side',
    form: 'bridge',
    bilateral: false,
    isHold: false,
    topAngle: 155,
    bottomAngle: 120,
    minimumRom: 25,
    minRepMs: 600,
    startCue: 'Lie on your back with knees bent, feet planted, and hips lowered.',
    moveCue: 'Lift your hips until shoulders, hips, and knees form a steady line.',
    returnCue: 'Lower your hips slowly to the starting position.',
    cameraCue: 'Side view · shoulders, hips, knees, and feet visible',
  }),
  crunch: profile({
    name: 'Controlled crunch',
    category: 'Core',
    joints: [11, 23, 25, 27],
    signal: 'hip',
    direction: 'decrease',
    view: 'side',
    form: 'crunch',
    bilateral: false,
    isHold: false,
    topAngle: 125,
    bottomAngle: 95,
    minimumRom: 20,
    minRepMs: 600,
    startCue: 'Lie on your back with knees bent and shoulders lowered.',
    moveCue: 'Lift your shoulders gently toward your knees without pulling your neck.',
    returnCue: 'Lower your shoulders slowly to finish the rep.',
    cameraCue: 'Side view · shoulders, hips, knees, and ankles visible',
  }),
  row: profile({
    name: 'Bent-over row',
    category: 'Upper body',
    joints: [11, 13, 15, 23, 25, 27],
    signal: 'elbow',
    direction: 'decrease',
    view: 'side',
    form: 'row',
    bilateral: false,
    isHold: false,
    topAngle: 145,
    bottomAngle: 90,
    minimumRom: 40,
    minRepMs: 500,
    startCue: 'Hinge at your hips with a steady trunk and arms extended.',
    moveCue: 'Pull your elbows back while keeping your trunk steady.',
    returnCue: 'Lower the weights under control until your arms are extended.',
    cameraCue: 'Side view · arms and whole torso visible',
  }),
  sideplank: profile({
    name: 'Side plank',
    category: 'Core',
    joints: [11, 23, 27],
    signal: 'body',
    direction: 'decrease',
    view: 'either',
    form: 'sideplank',
    bilateral: false,
    isHold: true,
    topAngle: 160,
    bottomAngle: 135,
    minimumRom: 0,
    minRepMs: 600,
    startCue: 'Lie on one side and lift into a straight shoulder-to-ankle line.',
    moveCue: 'Keep hips lifted and breathe comfortably.',
    returnCue: 'Rest, then repeat on the other side.',
    cameraCue: 'Front view of your body · select the supporting side',
  }),
};

export type ProfileExerciseId = keyof typeof exerciseProfiles;
export const exerciseIds = Object.keys(exerciseProfiles) as [
  ProfileExerciseId,
  ...ProfileExerciseId[],
];
export function getExerciseProfile(exercise: string): ExerciseProfile {
  const result = (exerciseProfiles as Record<string, ExerciseProfile>)[exercise];
  if (!result) throw new Error('This exercise has no automatic measurement profile.');
  return result;
}
export function isHoldExercise(exercise: string): boolean {
  return (exerciseProfiles as Record<string, ExerciseProfile>)[exercise]?.isHold ?? false;
}

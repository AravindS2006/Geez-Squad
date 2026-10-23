export function setFeedback(number: number, amount: number, target: number, hold: boolean) {
  return `Set ${number} ${amount >= target ? 'complete' : 'finished early'} · ${amount}/${target} ${hold ? 'seconds' : 'reps'}`;
}
export function workoutFeedback(targets: boolean[]) {
  const reached = targets.filter(Boolean).length;
  return reached === targets.length
    ? 'Workout complete'
    : `Workout finished · ${reached} of ${targets.length} targets reached`;
}

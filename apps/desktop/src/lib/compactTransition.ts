export async function completeCompactTransition<T>({
  commitCompact,
  showCompact,
  afterCompactPaint,
  finishHandoff,
}: {
  commitCompact: () => Promise<T>;
  showCompact: () => void;
  afterCompactPaint: () => Promise<void>;
  finishHandoff: () => Promise<void>;
}): Promise<T> {
  const result = await commitCompact();
  showCompact();
  await afterCompactPaint();
  try {
    await finishHandoff();
  } catch {
    // The main compact surface is already painted; a stale handoff must not
    // force the application back into the expanded state.
  }
  return result;
}

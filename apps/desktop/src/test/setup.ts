import "@testing-library/jest-dom/vitest";

if (!window.PointerEvent) {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
}

/**
 * Scroll-shell classes shared by the welcome and workspace stages: the single
 * scrolling root each stage renders (custom overlay scrollbar, viewport-locked
 * height, column flow). Kept in one place so the two shells can't drift apart.
 */
export const SHELL_CLASS = 'overlay-scroll h-[100dvh] overflow-y-auto overflow-x-hidden flex flex-col';

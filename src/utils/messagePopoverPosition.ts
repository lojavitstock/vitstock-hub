export type PopoverAnchorRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>;

export type PopoverPosition = {
  top: number;
  left: number;
};

type PopoverSize = {
  width: number;
  height: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

const VIEWPORT_GUTTER = 8;
const POPOVER_GAP = 6;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

/** Positions portal popovers without relying on a timeline ancestor's stacking context. */
export const positionMessageActionMenu = (
  anchor: PopoverAnchorRect,
  menu: PopoverSize,
  viewport: ViewportSize,
  align: 'left' | 'right',
): PopoverPosition => {
  const maximumLeft = Math.max(VIEWPORT_GUTTER, viewport.width - menu.width - VIEWPORT_GUTTER);
  const preferredLeft = align === 'left' ? anchor.left : anchor.right - menu.width;
  const below = anchor.bottom + POPOVER_GAP;
  const above = anchor.top - menu.height - POPOVER_GAP;
  const top = below + menu.height <= viewport.height - VIEWPORT_GUTTER
    ? below
    : Math.max(VIEWPORT_GUTTER, above);

  return { top, left: clamp(preferredLeft, VIEWPORT_GUTTER, maximumLeft) };
};

export const positionReactionPalette = (
  anchor: PopoverAnchorRect,
  palette: PopoverSize,
  viewport: ViewportSize,
): PopoverPosition => {
  const maximumLeft = Math.max(VIEWPORT_GUTTER, viewport.width - palette.width - VIEWPORT_GUTTER);
  const preferredRight = anchor.right + POPOVER_GAP;
  const preferredLeft = anchor.left - palette.width - POPOVER_GAP;
  const left = preferredRight + palette.width <= viewport.width - VIEWPORT_GUTTER
    ? preferredRight
    : preferredLeft >= VIEWPORT_GUTTER
      ? preferredLeft
      : clamp(preferredRight, VIEWPORT_GUTTER, maximumLeft);
  const top = clamp(anchor.top, VIEWPORT_GUTTER, Math.max(VIEWPORT_GUTTER, viewport.height - palette.height - VIEWPORT_GUTTER));

  return { top, left };
};

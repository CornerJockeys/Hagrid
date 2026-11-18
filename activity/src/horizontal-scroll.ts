export function enableMobileHorizontalScroll(
  scroller: HTMLElement,
  leftButton?: HTMLButtonElement | null,
  rightButton?: HTMLButtonElement | null,
): void {
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let horizontal: boolean | null = null;
  let active = false;

  scroller.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) {
      active = false;
      horizontal = null;
      return;
    }
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startScrollLeft = scroller.scrollLeft;
    horizontal = null;
    active = true;
  }, {passive: true});

  scroller.addEventListener("touchmove", event => {
    if (!active || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (horizontal === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      horizontal = Math.abs(dx) > Math.abs(dy);
    }

    if (!horizontal) return;
    event.preventDefault();
    scroller.scrollLeft = startScrollLeft - dx;
  }, {passive: false});

  const end = (): void => {
    active = false;
    horizontal = null;
  };
  scroller.addEventListener("touchend", end, {passive: true});
  scroller.addEventListener("touchcancel", end, {passive: true});

  const scrollByPage = (direction: -1 | 1): void => {
    const amount = Math.max(180, Math.floor(scroller.clientWidth * 0.75));
    scroller.scrollBy({left: direction * amount, behavior: "smooth"});
  };

  leftButton?.addEventListener("click", () => scrollByPage(-1));
  rightButton?.addEventListener("click", () => scrollByPage(1));
}

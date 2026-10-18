import { pageIndex } from './reading-layout';

/** Temporary, inert DOM copies keep the actual text selectable between turns. */
function snapshot(frame: HTMLElement, page: number, width: number, height: number) {
  const clone = frame.cloneNode(true) as HTMLElement;
  clone.dataset.current = 'true';
  clone.classList.add('reader-page-snapshot');
  clone.removeAttribute('id');
  clone.setAttribute('aria-hidden', 'true');
  clone.inert = true;
  clone.style.cssText = `position:absolute;inset:0;width:${width}px;height:${height}px;visibility:visible;`;
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  clone.querySelectorAll('.passage-actions').forEach((node) => node.remove());
  const viewport = frame.querySelector<HTMLElement>('.page-viewport')!;
  const content = clone.querySelector<HTMLElement>('[data-book-page]')!;
  content.style.transform = `translateX(${-page * viewport.clientWidth}px)`;
  return clone;
}

export function createPageMotion(
  root: HTMLElement,
  current: HTMLElement,
  target: HTMLElement,
  targetPage: number,
  direction: -1 | 1,
  effect: 'curl' | 'slide',
  touchY = 0.5,
) {
  const bounds = current.getBoundingClientRect();
  const width = bounds.width,
    height = bounds.height;
  const layer = document.createElement('div');
  layer.className = 'reader-motion-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  layer.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${width}px;height:${height}px;`;
  const underneath = snapshot(target, targetPage, width, height);
  layer.append(underneath);
  const shadow = document.createElement('div');
  shadow.className = 'reader-fold-shadow';
  layer.append(shadow);
  const strips: HTMLElement[] = [];
  // Large chapters use two layers rather than multiplying a large DOM for the mesh.
  const curl = effect === 'curl' && current.querySelectorAll('*').length < 400;
  const count = curl ? 48 : 1;
  const source = snapshot(current, pageIndex(current), width, height);
  for (let i = 0; i < count; i++) {
    const strip = document.createElement('div');
    strip.className = 'reader-page-strip';
    strip.style.width = `${width / count + 0.6}px`;
    strip.style.transformOrigin = `${width / count / 2}px 50%`;
    const copy = i === 0 ? source : (source.cloneNode(true) as HTMLElement);
    copy.style.left = `${(-i * width) / count}px`;
    copy.style.right = 'auto';
    const shade = document.createElement('div');
    shade.className = 'reader-paper-shade';
    strip.append(copy, shade);
    layer.append(strip);
    strips.push(strip);
  }
  root.closest('.reading-app')!.append(layer);
  function draw(value: number) {
    const progress = Math.max(0, Math.min(1, value));
    if (!curl) {
      strips[0].style.transform = `translateX(${-direction * progress * width}px)`;
      underneath.style.transform = `translateX(${direction * (1 - progress) * width}px)`;
      return;
    }
    const radius = width * (0.06 + 0.035 * Math.sin(progress * Math.PI));
    const fold = width - progress * (2 * width + Math.PI * radius);
    for (let i = 0; i < count; i++) {
      // Match the tangent at the middle of each slice. Sampling the leading edge
      // leaves visible gaps between slices at the tightest part of the curve.
      const x0 = ((i + 0.5) * width) / count;
      const s = direction === 1 ? x0 : width - x0;
      const distance = Math.max(0, s - fold);
      const angle = Math.min(Math.PI, distance / radius);
      const x =
        distance === 0
          ? s
          : fold + radius * Math.sin(angle) - Math.max(0, distance - Math.PI * radius);
      const z = radius * (1 - Math.cos(angle));
      const y = (touchY - 0.5) * Math.sin(angle) * 20;
      const strip = strips[i];
      strip.style.transform = `translate3d(${(direction === 1 ? x : width - x) - width / count / 2}px,${y}px,${z}px) rotateY(${-direction * angle}rad)`;
      strip.style.zIndex = String(Math.round(z * 10) + 1);
      (strip.firstElementChild as HTMLElement).style.opacity = angle > Math.PI / 2 ? '0.22' : '1';
      const shade = strip.lastElementChild as HTMLElement;
      shade.style.opacity = String(Math.sin(angle) * 0.18 + (angle > Math.PI / 2 ? 0.025 : 0));
    }
    shadow.style.width = `${radius * 1.3}px`;
    shadow.style.opacity = String(Math.sin(progress * Math.PI));
    shadow.style.left = `${direction === 1 ? fold + radius : width - fold - radius * 2.3}px`;
    shadow.style.transform = direction === 1 ? '' : 'scaleX(-1)';
  }
  draw(0);
  return { draw, remove: () => layer.remove() };
}

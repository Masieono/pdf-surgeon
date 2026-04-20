export function getWatermarkMargin(pageWidth, pageHeight) {
  return Math.max(12, Math.round(Math.min(pageWidth, pageHeight) * 0.04));
}

export function rotatePoint(x, y, rotationDeg) {
  const theta = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

export function getRotatedBoundsForRect({ minX, maxX, minY, maxY, rotationDeg }) {
  const points = [
    rotatePoint(minX, minY, rotationDeg),
    rotatePoint(maxX, minY, rotationDeg),
    rotatePoint(minX, maxY, rotationDeg),
    rotatePoint(maxX, maxY, rotationDeg),
  ];

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function clampWatermarkOrigin({ originX, originY, bounds, pageWidth, pageHeight, margin }) {
  let x = originX;
  let y = originY;

  x = Math.min(x, pageWidth - margin - bounds.maxX);
  x = Math.max(x, margin - bounds.minX);
  y = Math.min(y, pageHeight - margin - bounds.maxY);
  y = Math.max(y, margin - bounds.minY);

  return { x, y };
}

export function getWatermarkPlacement({ pageWidth, pageHeight, box, position, rotationDeg }) {
  const margin = getWatermarkMargin(pageWidth, pageHeight);
  const bounds = getRotatedBoundsForRect({
    minX: box.minX,
    maxX: box.maxX,
    minY: box.minY,
    maxY: box.maxY,
    rotationDeg,
  });

  if (position === "bottom_right") {
    return clampWatermarkOrigin({
      originX: pageWidth - margin - bounds.maxX,
      originY: margin - bounds.minY,
      bounds,
      pageWidth,
      pageHeight,
      margin,
    });
  }

  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;
  return {
    x: centerX - (bounds.minX + bounds.maxX) / 2,
    y: centerY - (bounds.minY + bounds.maxY) / 2,
  };
}

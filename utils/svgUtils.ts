
// Format matrix to string for DOM attribute
export const matrixToString = (m: DOMMatrix) => {
  const fix = (n: number) => Math.abs(n) < 1e-10 ? 0 : n;
  return `matrix(${fix(m.a)}, ${fix(m.b)}, ${fix(m.c)}, ${fix(m.d)}, ${fix(m.e)}, ${fix(m.f)})`;
};

// Get the transformation matrix of an element relative to the SVG root (User Space)
export const getElementGlobalMatrix = (element: SVGGraphicsElement, root: SVGSVGElement): DOMMatrix => {
  const rootMatrix = root.getScreenCTM();
  const elMatrix = element.getScreenCTM();
  
  if (!rootMatrix || !elMatrix) return new DOMMatrix();
  
  // Convert to standardized DOMMatrix to avoid "parameter 1 is not of type 'SVGMatrix'" errors
  const rootDomMatrix = DOMMatrix.fromMatrix(rootMatrix);
  const elDomMatrix = DOMMatrix.fromMatrix(elMatrix);
  
  return rootDomMatrix.inverse().multiply(elDomMatrix);
};

// Get the global matrix of the element's parent (to calculate local transform)
export const getParentGlobalMatrix = (element: SVGGraphicsElement, root: SVGSVGElement): DOMMatrix => {
  const parent = element.parentNode as SVGGraphicsElement;
  if (parent && parent instanceof SVGGraphicsElement && parent !== root) {
    return getElementGlobalMatrix(parent, root);
  }
  return new DOMMatrix(); // Identity if parent is root or not a graphics element
};

// Convert screen coordinates (mouse event) to SVG local coordinates
export const getSVGPoint = (svg: SVGSVGElement, x: number, y: number): DOMPoint => {
  // Use DOMPoint instead of SVGPoint to ensure compatibility with DOMMatrix
  const pt = new DOMPoint(x, y);
  const screenCTM = svg.getScreenCTM();
  if (!screenCTM) return pt;
  
  // Ensure we use DOMMatrix for the inverse operation
  const inverseMatrix = DOMMatrix.fromMatrix(screenCTM).inverse();
  return pt.matrixTransform(inverseMatrix);
};

// Decompose a matrix into translate, rotate, scale
export const decomposeMatrix = (matrix: DOMMatrix) => {
  const tx = matrix.e;
  const ty = matrix.f;
  const sx = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
  const sy = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d);
  const radians = Math.atan2(matrix.b, matrix.a);
  const angle = radians * (180 / Math.PI);

  return {
    x: tx,
    y: ty,
    rotation: angle,
    scaleX: sx,
    scaleY: sy
  };
};

// Get the Axis-Aligned Bounding Box of an element in World (SVG Root) Space
// ENHANCED: Takes clipping into account from element AND PARENTS
export const getTransformedBBox = (element: SVGGraphicsElement, svg: SVGSVGElement) => {
  let bbox = element.getBBox();

  // Helper to check for clip on an element and intersect the bbox
  const intersectClip = (el: Element, currentBBox: DOMRect, elMatrix: DOMMatrix) => {
      try {
          const style = window.getComputedStyle(el);
          const clipPathUrl = style.clipPath || el.getAttribute('clip-path');
          
          if (clipPathUrl && clipPathUrl !== 'none') {
              const match = clipPathUrl.match(/url\(['"]?#([^'"]+)['"]?\)/);
              if (match) {
                  const clipId = match[1];
                  const clipElement = svg.getElementById(clipId);
                  
                  if (clipElement) {
                      // Calculate the union BBox of all children in the clipPath
                      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                      let hasClipGeometry = false;

                      const clipChildren = Array.from(clipElement.children);
                      clipChildren.forEach(child => {
                          if (child instanceof SVGGraphicsElement) {
                              try {
                                  const childBBox = child.getBBox();
                                  if (childBBox.width > 0 || childBBox.height > 0) {
                                      minX = Math.min(minX, childBBox.x);
                                      minY = Math.min(minY, childBBox.y);
                                      maxX = Math.max(maxX, childBBox.x + childBBox.width);
                                      maxY = Math.max(maxY, childBBox.y + childBBox.height);
                                      hasClipGeometry = true;
                                  }
                              } catch(e) {}
                          }
                      });

                      if (hasClipGeometry) {
                          // The clip bbox is usually in the coordinate system of the clipped element 
                          // (if userSpaceOnUse, which is common for generated files).
                          // So we intersect directly in local space if possible.
                          // However, we passed `currentBBox` which is local to the *original element*.
                          // If `el` is a parent, the clip coords might be in parent space.
                          // This is complex. 
                          // Simplification: Assume clips are in the same user-space-on-use coordinate system (common for Batik).
                          
                          // Intersection of two rectangles
                          const intersectX = Math.max(currentBBox.x, minX);
                          const intersectY = Math.max(currentBBox.y, minY);
                          const intersectMaxX = Math.min(currentBBox.x + currentBBox.width, maxX);
                          const intersectMaxY = Math.min(currentBBox.y + currentBBox.height, maxY);

                          if (intersectMaxX > intersectX && intersectMaxY > intersectY) {
                              return {
                                  x: intersectX,
                                  y: intersectY,
                                  width: intersectMaxX - intersectX,
                                  height: intersectMaxY - intersectY,
                                  toJSON: () => {}
                              } as DOMRect;
                          }
                      }
                  }
              }
          }
      } catch (e) {
          console.warn("Error calculating clipped bbox", e);
      }
      return currentBBox;
  };

  // Check element itself
  // Note: We are assuming clips share the coordinate space (common in generated charts). 
  // If clips are relative, this approximation might need work, but it fixes the "huge box" issue.
  bbox = intersectClip(element, bbox, new DOMMatrix());

  // Check parents for clips too!
  // Use parentNode instead of parentElement to avoid TS error comparing HTMLElement with SVGSVGElement
  let parent = element.parentNode;
  while(parent && parent !== svg && parent instanceof SVGElement) {
      bbox = intersectClip(parent, bbox, new DOMMatrix());
      parent = parent.parentNode;
  }

  // Use Global Matrix (Element -> Root User Space)
  const matrix = getElementGlobalMatrix(element, svg);
  
  // 4 corners of the local bbox
  const pts = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    { x: bbox.x, y: bbox.y + bbox.height }
  ];

  // Transform corners to World Space using DOMPoint
  const transformedPts = pts.map(p => {
    const pt = new DOMPoint(p.x, p.y);
    return pt.matrixTransform(matrix);
  });

  const xs = transformedPts.map(p => p.x);
  const ys = transformedPts.map(p => p.y);
  
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
};

// Calculate the BBox of an element including its OWN transform only.
// Useful for previews where <use> includes the element's transform.
export const getElementOwnBBox = (el: SVGGraphicsElement): {x:number, y:number, width:number, height:number} => {
    let bbox;
    try {
        bbox = el.getBBox();
    } catch (e) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    if (el.transform && el.transform.baseVal && el.transform.baseVal.numberOfItems > 0) {
        const matrix = el.transform.baseVal.consolidate()?.matrix;
        if (matrix) {
            const pts = [
                new DOMPoint(bbox.x, bbox.y),
                new DOMPoint(bbox.x + bbox.width, bbox.y),
                new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height),
                new DOMPoint(bbox.x, bbox.y + bbox.height)
            ];
            
            const tPts = pts.map(p => p.matrixTransform(matrix));
            const xs = tPts.map(p => p.x);
            const ys = tPts.map(p => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            
            return {
                x: minX,
                y: minY,
                width: Math.max(...xs) - minX,
                height: Math.max(...ys) - minY
            };
        }
    }
    
    return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
};

export const downloadSVG = (svgElement: SVGSVGElement, filename: string = 'edited.svg') => {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgElement);

  if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!source.match(/^<svg[^>]+"http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
    source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  source = '<?xml version="1.0" standalone="no"?>\r\n' + source;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);

  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
};

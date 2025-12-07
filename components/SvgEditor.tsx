
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TransformGizmo } from './TransformGizmo';
import { getElementGlobalMatrix, getParentGlobalMatrix, getSVGPoint, downloadSVG, decomposeMatrix, getTransformedBBox, matrixToString, getElementOwnBBox } from '../utils/svgUtils';
import { Download, Trash2, Undo, Redo, Upload, Layers, FileText } from 'lucide-react';
import { LayerPanel, LayerNode } from './LayerPanel';

interface SvgEditorProps {
  initialContent?: string;
  onUpload?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const cleanSVG = (source: string) => {
  // Remove XML declaration and DOCTYPE (handling multi-line)
  let cleaned = source.replace(/<\?xml[\s\S]*?\?>/gi, '').trim();
  cleaned = cleaned.replace(/<!DOCTYPE[\s\S]*?>/gi, '').trim();
  // Remove comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '').trim();
  return cleaned;
};

export const SvgEditor: React.FC<SvgEditorProps> = ({ initialContent, onUpload }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layerPanelRef = useRef<HTMLDivElement>(null);
  
  // Canvas Size State
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });

  // SVG View Configuration (to sync overlay with content)
  const [svgConfig, setSvgConfig] = useState<{ viewBox: string; preserveAspectRatio: string }>({ 
    viewBox: '0 0 800 600', 
    preserveAspectRatio: 'xMidYMid meet' 
  });

  // Selection State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  
  // Tree State
  const [layerTree, setLayerTree] = useState<LayerNode[]>([]);

  // History State
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Gizmo Visual State
  const [bbox, setBbox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [gizmoTransform, setGizmoTransform] = useState('');

  // Box Selection State
  const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null);

  // Hover State
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverBbox, setHoverBbox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Interaction State
  const interactionRef = useRef<{
    mode: 'idle' | 'dragging' | 'rotating' | 'scaling-tl' | 'scaling-tr' | 'scaling-bl' | 'scaling-br' | 'box-selecting' | 'canvas-resizing-r' | 'canvas-resizing-b' | 'canvas-resizing-br';
    startPoint: DOMPoint;
    initialGlobalTransforms: Map<string, DOMMatrix>; // Element -> Root Space Matrix
    parentInverseTransforms: Map<string, DOMMatrix>; // Parent -> Root Space Inverse (to get back to local)
    center: { x: number, y: number }; // Center of the selection group (World Space)
    startBbox: { x: number; y: number; width: number; height: number }; // BBox at start of interaction
    startAngle: number; // For rotation
    startDist: number; // For scaling (legacy/fallback)
    hasMoved: boolean; // Track if actual movement occurred
    startCanvasSize: { width: number, height: number }; // For canvas resizing
    startViewBox: { x: number, y: number, w: number, h: number }; // For aspect-ratio correct cropping
  }>({
    mode: 'idle',
    startPoint: new DOMPoint(),
    initialGlobalTransforms: new Map(),
    parentInverseTransforms: new Map(),
    center: { x: 0, y: 0 },
    startBbox: { x: 0, y: 0, width: 0, height: 0 },
    startAngle: 0,
    startDist: 0,
    hasMoved: false,
    startCanvasSize: { width: 0, height: 0 },
    startViewBox: { x: 0, y: 0, w: 0, h: 0 }
  });

  // Helper to save history
  const saveToHistory = useCallback(() => {
    if (!containerRef.current) return;
    const content = containerRef.current.innerHTML;
    
    setHistory(prev => {
        // Discard any future history if we are in the middle of the stack
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(content);
        return newHistory;
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // Recursively build tree from DOM
  const buildLayerTree = useCallback((element: Element): LayerNode[] => {
     const nodes: LayerNode[] = [];
     Array.from(element.children).forEach(child => {
        if (child instanceof SVGGraphicsElement) {
           const tagName = child.tagName.toLowerCase();
           
           // Skip hidden defs/etc
           if (['defs', 'clippath', 'mask', 'pattern', 'marker', 'symbol'].includes(tagName)) return;

           // Assign ID if missing
           if (!child.id) child.id = `layer-${Math.random().toString(36).substr(2, 9)}`;

           let bbox;
           try {
             bbox = getElementOwnBBox(child);
           } catch (e) {
             // Fallback or ignore
           }

           // Extract Geometry for Preview
           let geometry: LayerNode['geometry'] | undefined;
           
           // Get computed style for critical visual properties to ensure we capture CSS-defined styles
           // or browser defaults (like black fill for paths)
           const computedStyle = window.getComputedStyle(child);
           
           const getAttrOrStyle = (name: string) => {
              const attr = child.getAttribute(name);
              if (attr) return attr;
              // If not in attribute, check computed style, but only for meaningful values
              // Note: computedStyle returns resolved colors (rgb), which is good for preview
              const styleVal = computedStyle.getPropertyValue(name);
              return styleVal !== 'none' && styleVal !== 'auto' ? styleVal : null;
           };

           const commonAttrs: Record<string, string | null> = {
               'transform': child.getAttribute('transform'),
               'opacity': child.getAttribute('opacity'),
               // Use computed styles for colors to fix "invisible black lines" issue
               'fill': getAttrOrStyle('fill'),
               'stroke': getAttrOrStyle('stroke'),
               'stroke-width': getAttrOrStyle('stroke-width'),
           };

           const getSpecificAttrs = (names: string[]) => {
              const attrs: Record<string, string | null> = { ...commonAttrs };
              names.forEach(name => {
                 attrs[name] = child.getAttribute(name);
              });
              return attrs;
           };

           if (tagName === 'path') {
               geometry = { type: 'path', attrs: getSpecificAttrs(['d']) };
           } else if (tagName === 'rect') {
               geometry = { type: 'rect', attrs: getSpecificAttrs(['x', 'y', 'width', 'height', 'rx', 'ry']) };
           } else if (tagName === 'circle') {
               geometry = { type: 'circle', attrs: getSpecificAttrs(['cx', 'cy', 'r']) };
           } else if (tagName === 'ellipse') {
               geometry = { type: 'ellipse', attrs: getSpecificAttrs(['cx', 'cy', 'rx', 'ry']) };
           } else if (tagName === 'line') {
               geometry = { type: 'line', attrs: getSpecificAttrs(['x1', 'y1', 'x2', 'y2']) };
           } else if (tagName === 'polyline') {
               geometry = { type: 'polyline', attrs: getSpecificAttrs(['points']) };
           } else if (tagName === 'polygon') {
               geometry = { type: 'polygon', attrs: getSpecificAttrs(['points']) };
           }

           const node: LayerNode = {
              id: child.id,
              tagName: tagName,
              name: child.getAttribute('inkscape:label') || child.getAttribute('data-name') || undefined,
              children: buildLayerTree(child),
              bbox,
              geometry
           };
           nodes.push(node);
        }
     });
     // Reverse so top visual layer is at top of list
     return nodes.reverse(); 
  }, []);

  // Update Tree Data
  const updateTree = useCallback(() => {
     if (svgRef.current) {
        const tree = buildLayerTree(svgRef.current);
        setLayerTree(tree);
     }
  }, [buildLayerTree]);

  // Load Initial Content
  useEffect(() => {
    if (containerRef.current && initialContent) {
      // 1. Clean and Inject
      const cleanedContent = cleanSVG(initialContent);
      containerRef.current.innerHTML = cleanedContent;
      
      const svg = containerRef.current.querySelector('svg');
      if (svg) {
        svgRef.current = svg;
        
        // 2. Normalize SVG Dimensions / ViewBox
        let width = 800;
        let height = 600;
        const currentW = svg.getAttribute('width');
        const currentH = svg.getAttribute('height');
        
        // Try to parse existing dimensions
        if (currentW && !currentW.includes('%')) width = parseFloat(currentW) || 800;
        if (currentH && !currentH.includes('%')) height = parseFloat(currentH) || 600;

        setCanvasSize({ width, height });

        // Force SVG to fill container for display
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.overflow = 'visible';
        svg.style.display = 'block';

        // Ensure width/height attributes are set on the SVG so they exist for export
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));

        // Auto-fit Logic for ViewBox
        requestAnimationFrame(() => {
            if (!svgRef.current) return;
            
            let currentVb = svg.getAttribute('viewBox');

            if (!currentVb) {
                if (currentW && currentH && !currentW.includes('%') && !currentH.includes('%')) {
                     const valW = parseFloat(currentW);
                     const valH = parseFloat(currentH);
                     currentVb = `0 0 ${valW} ${valH}`;
                     svg.setAttribute('viewBox', currentVb);
                } else {
                    try {
                        const bbox = svg.getBBox();
                        if (bbox.width > 0 && bbox.height > 0) {
                            const padX = bbox.width * 0.05;
                            const padY = bbox.height * 0.05;
                            currentVb = `${bbox.x - padX} ${bbox.y - padY} ${bbox.width + padX*2} ${bbox.height + padY*2}`;
                            svg.setAttribute('viewBox', currentVb);
                        } else {
                             currentVb = '0 0 800 600';
                             svg.setAttribute('viewBox', currentVb);
                        }
                    } catch (e) {
                        currentVb = '0 0 800 600';
                        svg.setAttribute('viewBox', currentVb);
                    }
                }
            }

            setSvgConfig({
              viewBox: currentVb || '0 0 800 600',
              preserveAspectRatio: svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet'
            });

            // Ensure IDs on all relevant elements (Leafs AND Groups now)
            const assignIds = (el: Element) => {
                const tagName = el.tagName.toLowerCase();
                // Skip definitions
                if (['defs', 'clippath', 'mask', 'pattern'].includes(tagName)) return;
                
                if (el instanceof SVGGraphicsElement) {
                   if (!el.id) {
                       el.id = `el-${Math.random().toString(36).substr(2, 6)}`;
                   }
                   Array.from(el.children).forEach(assignIds);
                }
            };
            Array.from(svg.children).forEach(assignIds);

            // Initialize History
            setHistory([containerRef.current?.innerHTML || '']);
            setHistoryIndex(0);
            updateTree();
        });
      }
    }
    setSelectedIds([]);
    setSelectionAnchorId(null);
    setBbox(null);
    setHoveredId(null);
    setHoverBbox(null);
  }, [initialContent, updateTree]);

  // Undo / Redo Logic
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      if (containerRef.current) {
        containerRef.current.innerHTML = history[newIndex];
        const svg = containerRef.current.querySelector('svg');
        if (svg) {
            svgRef.current = svg;
            // Update canvas size from history content
            const w = parseFloat(svg.getAttribute('width') || '800');
            const h = parseFloat(svg.getAttribute('height') || '600');
            setCanvasSize({ width: w, height: h });
            
            // Sync internal state with history
            const vb = svg.getAttribute('viewBox') || '0 0 800 600';
            setSvgConfig(prev => ({...prev, viewBox: vb}));
        }
        setSelectedIds([]); 
        setSelectionAnchorId(null);
        setBbox(null);
        setHoveredId(null);
        updateTree();
      }
    }
  }, [history, historyIndex, updateTree]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      if (containerRef.current) {
        containerRef.current.innerHTML = history[newIndex];
        const svg = containerRef.current.querySelector('svg');
        if (svg) {
            svgRef.current = svg;
            // Update canvas size from history content
            const w = parseFloat(svg.getAttribute('width') || '800');
            const h = parseFloat(svg.getAttribute('height') || '600');
            setCanvasSize({ width: w, height: h });
            
            // Sync internal state with history
            const vb = svg.getAttribute('viewBox') || '0 0 800 600';
            setSvgConfig(prev => ({...prev, viewBox: vb}));
        }
        setSelectedIds([]);
        setSelectionAnchorId(null);
        setBbox(null);
        setHoveredId(null);
        updateTree();
      }
    }
  }, [history, historyIndex, updateTree]);


  // Update Gizmo based on selection
  const updateGizmo = useCallback(() => {
    if (selectedIds.length === 0 || !svgRef.current) {
      setBbox(null);
      return;
    }

    const svg = svgRef.current;

    if (selectedIds.length === 1) {
      const el = svg.getElementById(selectedIds[0]) as SVGGraphicsElement;
      if (!el) {
        // Element might have been deleted but id still in selection
        return;
      }
      
      const matrix = getElementGlobalMatrix(el, svg);
      const decomposed = decomposeMatrix(matrix);

      let isClipped = false;
      let currentEl: Element | null = el;
      while(currentEl && currentEl !== svg) {
          const style = window.getComputedStyle(currentEl);
          if (style.clipPath && style.clipPath !== 'none') {
              isClipped = true; 
              break;
          }
          currentEl = currentEl.parentElement;
      }

      if (isClipped) {
         const worldBox = getTransformedBBox(el, svg);
         setBbox(worldBox);
         setRotation(0);
         setGizmoTransform('');
      } else {
         try {
             const localBBox = el.getBBox();
             setBbox({
                x: localBBox.x,
                y: localBBox.y,
                width: localBBox.width,
                height: localBBox.height
             });
             setRotation(decomposed.rotation);
             setGizmoTransform(matrixToString(matrix));
         } catch (e) {
             // Fallback for elements where getBBox might fail (rare)
             setBbox(null);
         }
      }
    } 
    else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasValid = false;

      selectedIds.forEach(id => {
        const el = svg.getElementById(id) as SVGGraphicsElement;
        if (el) {
          const box = getTransformedBBox(el, svg);
          if (box.width > 0 && box.height > 0) {
              if (box.x < minX) minX = box.x;
              if (box.y < minY) minY = box.y;
              if (box.x + box.width > maxX) maxX = box.x + box.width;
              if (box.y + box.height > maxY) maxY = box.y + box.height;
              hasValid = true;
          }
        }
      });

      if (hasValid && minX !== Infinity) {
        setBbox({
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        });
        setRotation(0);
        setGizmoTransform('');
      } else {
        setBbox(null);
      }
    }
  }, [selectedIds]);

  // Run updateGizmo whenever selection changes
  useEffect(() => {
    updateGizmo();
  }, [updateGizmo]);


  // ---- Interaction Helpers ----

  // Helper to filter children if parent is selected to avoid double transformation
  const getEffectiveSelection = (svg: SVGSVGElement, ids: string[]) => {
      const idSet = new Set(ids);
      return ids.filter(id => {
          // Cast el to Element | null to ensure parentElement is compatible (Element | null)
          // because svg.getElementById might return HTMLElement which is incompatible with SVGSVGElement in some TS versions
          const el = svg.getElementById(id) as Element | null;
          let parent = el?.parentElement as Element | null;
          while (parent && parent !== svg) {
              if (parent.id && idSet.has(parent.id)) return false;
              parent = parent.parentElement as Element | null;
          }
          return true;
      });
  };

  const startInteraction = (
    mode: typeof interactionRef.current.mode, 
    clientX: number, 
    clientY: number,
    ids: string[]
  ) => {
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const startPoint = getSVGPoint(svg, clientX, clientY);

    if (mode === 'box-selecting') {
       interactionRef.current = {
         mode,
         startPoint, 
         initialGlobalTransforms: new Map(),
         parentInverseTransforms: new Map(),
         center: { x: 0, y: 0 },
         startBbox: { x: 0, y: 0, width: 0, height: 0 },
         startAngle: 0,
         startDist: 0,
         hasMoved: false,
         startCanvasSize: { width: 0, height: 0 },
         startViewBox: { x: 0, y: 0, w: 0, h: 0 }
       };
       return;
    }

    if (ids.length === 0) return;

    // Filter selection to avoid double-transforming nested elements
    const effectiveIds = getEffectiveSelection(svg, ids);

    // 1. Capture initial matrices
    const initialGlobalTransforms = new Map<string, DOMMatrix>();
    const parentInverseTransforms = new Map<string, DOMMatrix>();
    
    effectiveIds.forEach(id => {
      const el = svg.getElementById(id) as SVGGraphicsElement;
      if (el) {
        initialGlobalTransforms.set(id, getElementGlobalMatrix(el, svg));
        parentInverseTransforms.set(id, getParentGlobalMatrix(el, svg).inverse());
      }
    });

    // 2. Calculate Group Center (World Space) & Bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasCount = 0;
    
    // We calculate bounds of ALL selected items to determine the group center/bbox
    // Note: We use the *effective* IDs for bounds to match what we transform, 
    // but typically gizmo bounds come from all IDs.
    // For consistent transform, let's use the gizmo logic which usually includes all.
    // The Gizmo surrounds ALL selected items.
    
    ids.forEach(id => {
      const el = svg.getElementById(id) as SVGGraphicsElement;
      if (el) {
        try {
            const box = getTransformedBBox(el, svg);
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
            hasCount++;
        } catch(e) {}
      }
    });

    const centerX = hasCount > 0 ? minX + (maxX - minX) / 2 : 0;
    const centerY = hasCount > 0 ? minY + (maxY - minY) / 2 : 0;
    
    const startBbox = hasCount > 0 
        ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
        : { x: 0, y: 0, width: 0, height: 0 };

    let startAngle = 0;
    let startDist = 0;

    if (mode === 'rotating') {
      startAngle = Math.atan2(startPoint.y - centerY, startPoint.x - centerX);
    } else if (mode.startsWith('scaling')) {
      startDist = Math.hypot(startPoint.x - centerX, startPoint.y - centerY);
    }

    interactionRef.current = {
      mode,
      startPoint,
      initialGlobalTransforms,
      parentInverseTransforms,
      center: { x: centerX, y: centerY },
      startBbox,
      startAngle,
      startDist,
      hasMoved: false,
      startCanvasSize: { width: 0, height: 0 },
      startViewBox: { x: 0, y: 0, w: 0, h: 0 }
    };
  };

  const moveSelectedElements = useCallback((dx: number, dy: number) => {
     if (selectedIds.length === 0 || !svgRef.current) return;
     const svg = svgRef.current;
     
     const effectiveIds = getEffectiveSelection(svg, selectedIds);

     effectiveIds.forEach(id => {
         const el = svg.getElementById(id) as SVGGraphicsElement;
         if (!el) return;
         
         // 1. Get Current Global
         const globalMatrix = getElementGlobalMatrix(el, svg);
         
         // 2. Apply Translation in Global Space (Pre-multiply)
         // We translate the coordinate system relative to root
         const translation = new DOMMatrix().translate(dx, dy);
         const newGlobal = translation.multiply(globalMatrix);

         // 3. Convert back to Local
         const parentGlobal = getParentGlobalMatrix(el, svg);
         const parentInverse = parentGlobal.inverse();
         const localMatrix = parentInverse.multiply(newGlobal);

         // 4. Update
         el.setAttribute('transform', matrixToString(localMatrix));
     });
     
     updateGizmo();
     saveToHistory();
     updateTree();
  }, [selectedIds, updateGizmo, saveToHistory, updateTree]);

  // ---- Mouse Handlers (Attached to Container) ----

  // Canvas Resize Handlers
  const handleCanvasResizeStart = (
    direction: 'canvas-resizing-r' | 'canvas-resizing-b' | 'canvas-resizing-br',
    e: React.MouseEvent
  ) => {
      e.preventDefault();
      e.stopPropagation();
      if (!svgRef.current) return;

      const startPoint = new DOMPoint(e.clientX, e.clientY);
      
      // Parse current ViewBox for cropping logic
      let currentVb = svgRef.current.getAttribute('viewBox') || `0 0 ${canvasSize.width} ${canvasSize.height}`;
      const parts = currentVb.split(' ').map(parseFloat);
      const startViewBox = { 
          x: parts[0] || 0, 
          y: parts[1] || 0, 
          w: parts[2] || canvasSize.width, 
          h: parts[3] || canvasSize.height 
      };

      interactionRef.current = {
          mode: direction,
          startPoint,
          initialGlobalTransforms: new Map(),
          parentInverseTransforms: new Map(),
          center: { x: 0, y: 0 },
          startBbox: { x: 0, y: 0, width: 0, height: 0 },
          startAngle: 0,
          startDist: 0,
          hasMoved: false,
          startCanvasSize: { ...canvasSize },
          startViewBox
      };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (!svgRef.current) return;

    const target = e.target as Element;
    
    // Ignore clicks on gizmo or resize handles which have their own handlers
    if (target.closest('.gizmo-overlay')) {
      return; 
    }

    let clickedId: string | null = null;
    
    if (svgRef.current.contains(target) && target !== svgRef.current) {
        let el: Element | null = target;
        while (el && el !== svgRef.current) {
            if (el.id) {
                let parent = el.parentElement as Element | null;
                let isHidden = false;
                while (parent && parent !== svgRef.current) {
                    const tagName = parent.tagName.toLowerCase();
                    if (['defs', 'clippath', 'mask'].includes(tagName)) {
                        isHidden = true;
                        break;
                    }
                    parent = parent.parentElement as Element | null;
                }
                
                if (!isHidden) {
                    clickedId = el.id;
                    break;
                }
            }
            el = el.parentElement as Element | null;
        }
    }

    if (clickedId) {
       e.stopPropagation();
       // Critical fix: prevent default browser drag-and-drop behavior for SVG elements
       e.preventDefault(); 
       
       // Update anchor for range selections
       setSelectionAnchorId(clickedId);
       
       let newSelectedIds = [...selectedIds];
       
       if (e.shiftKey) {
         if (newSelectedIds.includes(clickedId)) {
            newSelectedIds = newSelectedIds.filter(id => id !== clickedId);
         } else {
            newSelectedIds.push(clickedId);
         }
       } else {
         if (!newSelectedIds.includes(clickedId)) {
            newSelectedIds = [clickedId];
         }
       }
       
       setSelectedIds(newSelectedIds);
       
       if (newSelectedIds.length > 0) {
          startInteraction('dragging', e.clientX, e.clientY, newSelectedIds);
       }
    } else {
      if (!e.shiftKey) {
        setSelectedIds([]);
        setSelectionAnchorId(null);
      }
      startInteraction('box-selecting', e.clientX, e.clientY, []);
    }
  };
  
  // Handler for hover effects (when idle)
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    // Only detect hover when not interacting
    if (interactionRef.current.mode !== 'idle' || !svgRef.current) {
       if (hoveredId) {
          setHoveredId(null);
          setHoverBbox(null);
       }
       return;
    }

    const target = e.target as Element;
    let foundId: string | null = null;

    if (svgRef.current.contains(target) && target !== svgRef.current) {
        let el: Element | null = target;
        while (el && el !== svgRef.current) {
            if (el.id) {
                let parent = el.parentElement as Element | null;
                let isHidden = false;
                while (parent && parent !== svgRef.current) {
                    const tagName = parent.tagName.toLowerCase();
                    if (['defs', 'clippath', 'mask'].includes(tagName)) {
                        isHidden = true;
                        break;
                    }
                    parent = parent.parentElement as Element | null;
                }
                
                if (!isHidden) {
                    foundId = el.id;
                    break;
                }
            }
            el = el.parentElement as Element | null;
        }
    }

    // Don't hover if it's the already selected item (gizmo handles it)
    if (foundId && selectedIds.includes(foundId)) {
        foundId = null;
    }

    if (foundId !== hoveredId) {
        if (foundId) {
           const svgEl = svgRef.current.getElementById(foundId) as SVGGraphicsElement;
           if (svgEl) {
              try {
                  const box = getTransformedBBox(svgEl, svgRef.current);
                  setHoveredId(foundId);
                  setHoverBbox(box);
              } catch (e) {
                  setHoveredId(null);
                  setHoverBbox(null);
              }
           }
        } else {
           setHoveredId(null);
           setHoverBbox(null);
        }
    }
  };

  const handleCanvasMouseLeave = () => {
      setHoveredId(null);
      setHoverBbox(null);
  };

  const handleGizmoMouseDown = (mode: any, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    startInteraction(mode, e.clientX, e.clientY, selectedIds);
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    const state = interactionRef.current;
    if (state.mode === 'idle') return;

    e.preventDefault();
    state.hasMoved = true;

    // Canvas Resizing Logic
    if (state.mode.startsWith('canvas-resizing')) {
        const dx = e.clientX - state.startPoint.x;
        const dy = e.clientY - state.startPoint.y;
        const newWidth = Math.max(100, state.startCanvasSize.width + dx);
        const newHeight = Math.max(100, state.startCanvasSize.height + dy);

        if (state.mode === 'canvas-resizing-r') {
            setCanvasSize(prev => ({ ...prev, width: newWidth }));
        } else if (state.mode === 'canvas-resizing-b') {
            setCanvasSize(prev => ({ ...prev, height: newHeight }));
        } else if (state.mode === 'canvas-resizing-br') {
            setCanvasSize({ width: newWidth, height: newHeight });
        }
        
        // Update SVG attributes in real-time
        if (svgRef.current) {
            let updateW = canvasSize.width;
            let updateH = canvasSize.height;

            if (state.mode.includes('r')) {
               svgRef.current.setAttribute('width', String(newWidth));
               updateW = newWidth;
            }
            if (state.mode.includes('b')) {
               svgRef.current.setAttribute('height', String(newHeight));
               updateH = newHeight;
            }
            
            // CROP LOGIC: Update ViewBox dimensions to match the new pixel dimensions.
            // This prevents "scaling" (shrinking/growing) of content.
            // We maintain the original origin (x, y) but update width (w) and height (h)
            // to match the container, effectively "opening/closing" the window into the SVG.
            
            // Scale Calculation (in case original viewBox wasn't 1:1 with pixels)
            const ratioX = state.startViewBox.w / state.startCanvasSize.width;
            const ratioY = state.startViewBox.h / state.startCanvasSize.height;

            // If we are resizing width, new viewbox width should scale accordingly
            const newVbW = state.mode.includes('r') ? state.startViewBox.w + (dx * ratioX) : state.startViewBox.w;
            const newVbH = state.mode.includes('b') ? state.startViewBox.h + (dy * ratioY) : state.startViewBox.h;

            const newViewBox = `${state.startViewBox.x} ${state.startViewBox.y} ${newVbW} ${newVbH}`;
            
            svgRef.current.setAttribute('viewBox', newViewBox);
            setSvgConfig(prev => ({...prev, viewBox: newViewBox}));
        }
        return;
    }

    if (!svgRef.current) return;
    const svg = svgRef.current;
    const currentPt = getSVGPoint(svg, e.clientX, e.clientY);
    const { startPoint, initialGlobalTransforms, parentInverseTransforms, center, startBbox } = state;


    if (state.mode === 'box-selecting') {
        const x = Math.min(startPoint.x, currentPt.x);
        const y = Math.min(startPoint.y, currentPt.y);
        const width = Math.abs(currentPt.x - startPoint.x);
        const height = Math.abs(currentPt.y - startPoint.y);
        setSelectionRect({ x, y, width, height });
        return;
    }

    // Prepare scaling parameters if needed
    let scaleMatrix = new DOMMatrix();
    let pivot = { x: 0, y: 0 };
    let isScaling = state.mode.startsWith('scaling');

    if (isScaling) {
        // Determine Pivot (Opposite Corner) and current Handle position logic
        let anchorX = 0, anchorY = 0;
        
        if (state.mode === 'scaling-br') {
            // Anchor is Top-Left
            anchorX = startBbox.x;
            anchorY = startBbox.y;
        } else if (state.mode === 'scaling-tl') {
            // Anchor is Bottom-Right
            anchorX = startBbox.x + startBbox.width;
            anchorY = startBbox.y + startBbox.height;
        } else if (state.mode === 'scaling-tr') {
            // Anchor is Bottom-Left
            anchorX = startBbox.x;
            anchorY = startBbox.y + startBbox.height;
        } else if (state.mode === 'scaling-bl') {
            // Anchor is Top-Right
            anchorX = startBbox.x + startBbox.width;
            anchorY = startBbox.y;
        }
        
        pivot = { x: anchorX, y: anchorY };

        // Calculate Scale Factors
        let sx = 1, sy = 1;
        
        // Prevent division by zero
        const safeW = startBbox.width || 1;
        const safeH = startBbox.height || 1;

        if (state.mode === 'scaling-br') {
            sx = (currentPt.x - anchorX) / safeW;
            sy = (currentPt.y - anchorY) / safeH;
        } else if (state.mode === 'scaling-tl') {
            sx = (anchorX - currentPt.x) / safeW;
            sy = (anchorY - currentPt.y) / safeH;
        } else if (state.mode === 'scaling-tr') {
            sx = (currentPt.x - anchorX) / safeW;
            sy = (anchorY - currentPt.y) / safeH;
        } else if (state.mode === 'scaling-bl') {
            sx = (anchorX - currentPt.x) / safeW;
            sy = (currentPt.y - anchorY) / safeH;
        }

        scaleMatrix = new DOMMatrix().scale(sx, sy);
    }

    initialGlobalTransforms.forEach((startGlobal, id) => {
      // Note: We already filtered ids in startInteraction, so this loop only processes effective parents.
      const el = svg.getElementById(id) as SVGGraphicsElement;
      if (!el) return;

      let newGlobal = startGlobal;

      if (state.mode === 'dragging') {
        const dx = currentPt.x - startPoint.x;
        const dy = currentPt.y - startPoint.y;
        newGlobal = new DOMMatrix().translate(dx, dy).multiply(startGlobal);
      } 
      else if (state.mode === 'rotating') {
        const currentAngle = Math.atan2(currentPt.y - center.y, currentPt.x - center.x);
        const deltaAngle = (currentAngle - state.startAngle) * (180 / Math.PI);
        const t1 = new DOMMatrix().translate(center.x, center.y);
        const r = new DOMMatrix().rotate(deltaAngle);
        const t2 = new DOMMatrix().translate(-center.x, -center.y);
        newGlobal = t1.multiply(r).multiply(t2).multiply(startGlobal);
      }
      else if (isScaling) {
        // Apply Scaling relative to Pivot (Anchor)
        const t1 = new DOMMatrix().translate(pivot.x, pivot.y);
        const t2 = new DOMMatrix().translate(-pivot.x, -pivot.y);
        newGlobal = t1.multiply(scaleMatrix).multiply(t2).multiply(startGlobal);
      }

      const parentInverse = parentInverseTransforms.get(id) || new DOMMatrix();
      const localMatrix = parentInverse.multiply(newGlobal);
      el.setAttribute('transform', matrixToString(localMatrix));
    });

    updateGizmo();
  }, [updateGizmo, canvasSize]); // Depend on canvasSize for resize updates

  const handleGlobalMouseUp = useCallback(() => {
    const state = interactionRef.current;
    
    if (state.mode === 'box-selecting' && state.hasMoved && selectionRect && svgRef.current) {
        const svg = svgRef.current;
        const newSelection: string[] = [];
        const allElements = Array.from(svg.querySelectorAll('*'));
        const allowedTags = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'image', 'text', 'use']);

        allElements.forEach(el => {
            const element = el as SVGGraphicsElement;
            if (!element.id) return;
            if (!allowedTags.has(element.tagName.toLowerCase())) return;

            let parent = element.parentElement as Element | null;
            let isHidden = false;
            while (parent && parent !== svg) {
                 if (['defs', 'clippath', 'mask'].includes(parent.tagName.toLowerCase())) {
                     isHidden = true; break;
                 }
                 parent = parent.parentElement;
            }
            if (isHidden) return;

            try {
                const box = getTransformedBBox(element, svg);
                const intersect = !(
                    box.x > selectionRect.x + selectionRect.width ||
                    box.x + box.width < selectionRect.x ||
                    box.y > selectionRect.y + selectionRect.height ||
                    box.y + box.height < selectionRect.y
                );
                
                if (intersect) {
                    newSelection.push(element.id);
                }
            } catch (e) {}
        });

        setSelectedIds(prev => Array.from(new Set([...prev, ...newSelection])));
        setSelectionRect(null);
    } 
    else if (state.mode.startsWith('canvas-resizing') && state.hasMoved) {
        saveToHistory();
    }
    else if (state.mode !== 'idle' && state.mode !== 'box-selecting' && state.hasMoved) {
      saveToHistory();
      // Update tree to refresh previews after drag/scale/rotate
      updateTree();
    }

    interactionRef.current = { ...interactionRef.current, mode: 'idle', hasMoved: false };
    setSelectionRect(null);
  }, [saveToHistory, selectionRect, updateTree]);

  useEffect(() => {
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);


  // ---- Actions ----

  const handleDelete = useCallback(() => {
    if (selectedIds.length === 0 || !svgRef.current) return;
    
    let deleted = false;
    selectedIds.forEach(id => {
       const el = svgRef.current?.getElementById(id);
       if (el) {
          el.remove();
          deleted = true;
       }
    });
    
    if (deleted) {
      saveToHistory();
      updateTree();
    }
    
    setSelectedIds([]);
    setSelectionAnchorId(null);
    setBbox(null);
    setHoveredId(null);
    setHoverBbox(null);
  }, [selectedIds, saveToHistory, updateTree]);

  // Keyboard Shortcuts for Canvas Area
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const activeElement = document.activeElement;
      
      // Prevent handling if typing in an input
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
         return;
      }

      // If the layer panel is focused, don't trigger canvas movement shortcuts
      if (activeElement && layerPanelRef.current && layerPanelRef.current.contains(activeElement)) {
          return;
      }
      
      // Also check if layerPanelRef itself is the active element (it has tabindex)
      if (activeElement === layerPanelRef.current) {
          return;
      }

      // Delete
      if (selectedIds.length > 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        handleDelete();
      }
      
      // Undo / Redo
      if (isCmdOrCtrl) {
        if (e.key === 'z') {
           e.preventDefault();
           if (e.shiftKey) {
             redo();
           } else {
             undo();
           }
        } else if (e.key === 'y') {
           e.preventDefault();
           redo();
        }
      }

      // Arrow Keys Movement
      if (selectedIds.length > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
         e.preventDefault();
         const step = e.shiftKey ? 10 : 1;
         let dx = 0;
         let dy = 0;

         switch(e.key) {
             case 'ArrowLeft': dx = -step; break;
             case 'ArrowRight': dx = step; break;
             case 'ArrowUp': dy = -step; break; // SVG y is down, so Up is negative
             case 'ArrowDown': dy = step; break;
         }

         moveSelectedElements(dx, dy);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, handleDelete, undo, redo, moveSelectedElements]);

  const handleDownload = () => {
    if (svgRef.current) {
      downloadSVG(svgRef.current, 'edited-design.svg');
    }
  };

  const handleDownloadPdf = () => {
    if (!svgRef.current) {
        alert("Design not ready to export.");
        return;
    }

    const svg = svgRef.current;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);

    const iframeId = 'pdf-export-iframe';
    let iframe = document.getElementById(iframeId) as HTMLIFrameElement;
    
    if (iframe) {
        document.body.removeChild(iframe);
    }

    iframe = document.createElement('iframe');
    iframe.id = iframeId;
    // Position off-screen but keep it part of layout so browsers render it
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px'; 
    iframe.style.top = '0';
    iframe.style.width = '1000px'; 
    iframe.style.height = '1000px';
    iframe.style.border = 'none';
    
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
        alert("Export failed: Browser prevented PDF generation.");
        return;
    }

    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>SVG Export</title>
            <style>
                @page { margin: 0; size: auto; }
                html, body { 
                    margin: 0; 
                    padding: 0; 
                    width: 100%; 
                    height: 100%; 
                    overflow: hidden; 
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                svg { 
                    width: 100%; 
                    height: 100%; 
                    display: block;
                }
            </style>
        </head>
        <body>
            ${svgString}
            <script>
                window.onload = function() {
                    // Small timeout ensures content is fully parsed and rendered
                    setTimeout(function() {
                        try {
                            window.focus();
                            window.print();
                        } catch(e) {
                            console.error('Print failed', e);
                        }
                    }, 500);
                }
            </script>
        </body>
        </html>
    `);
    doc.close();
  };
  
  // Flatten layers to get linear visual order for Shift+Click range selection and Keyboard nav
  const flattenLayerIds = useCallback((nodes: LayerNode[]): string[] => {
    return nodes.reduce((acc: string[], node) => {
      acc.push(node.id);
      if (node.children) {
        acc.push(...flattenLayerIds(node.children));
      }
      return acc;
    }, []);
  }, []);

  const handleTreeSelect = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      
      const isMulti = e.metaKey || e.ctrlKey;
      const isRange = e.shiftKey;
      
      // Handle Shift+Click (Range Selection)
      if (isRange && selectionAnchorId) {
          const flatList = flattenLayerIds(layerTree);
          const startIdx = flatList.indexOf(selectionAnchorId);
          const endIdx = flatList.indexOf(id);
          
          if (startIdx !== -1 && endIdx !== -1) {
              const min = Math.min(startIdx, endIdx);
              const max = Math.max(startIdx, endIdx);
              const range = flatList.slice(min, max + 1);
              
              setSelectedIds(range);
              // Note: Anchor does not change during shift-select operations to allow extending range
              return;
          }
      }
      
      // Non-range interaction updates the anchor
      setSelectionAnchorId(id);

      if (isMulti) {
          // Toggle selection
          setSelectedIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
      } else {
          // Single selection
          setSelectedIds([id]);
      }
  };

  const handleLayerListKeyDown = (e: React.KeyboardEvent) => {
      if (layerTree.length === 0) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
         e.preventDefault();
         e.stopPropagation();

         const flatIds = flattenLayerIds(layerTree);
         if (flatIds.length === 0) return;

         let nextId = flatIds[0];
         
         if (selectedIds.length > 0) {
             // Find index of the last selected item (or the single item)
             const lastSelected = selectedIds[selectedIds.length - 1];
             const currentIndex = flatIds.indexOf(lastSelected);
             
             if (currentIndex !== -1) {
                 if (e.key === 'ArrowDown') {
                     const nextIndex = Math.min(flatIds.length - 1, currentIndex + 1);
                     nextId = flatIds[nextIndex];
                 } else {
                     const prevIndex = Math.max(0, currentIndex - 1);
                     nextId = flatIds[prevIndex];
                 }
             }
         }

         setSelectedIds([nextId]);
         setSelectionAnchorId(nextId);
      }
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-50 relative select-none">
       {/* Toolbar */}
       <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shadow-sm z-10 shrink-0">
          <div className="flex items-center space-x-2 text-slate-700 font-semibold">
             <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center text-white">
               <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>
             </div>
             <span>SVG Studio</span>
          </div>

          <div className="flex items-center space-x-2">
             <div className="flex items-center bg-slate-100 rounded-md p-0.5 mr-4 border border-slate-200">
                <button 
                  onClick={undo} 
                  disabled={historyIndex <= 0}
                  className="p-1.5 rounded hover:bg-white hover:shadow-sm text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition-all"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo size={18} />
                </button>
                <div className="w-px h-4 bg-slate-300 mx-1"></div>
                <button 
                  onClick={redo} 
                  disabled={historyIndex >= history.length - 1}
                  className="p-1.5 rounded hover:bg-white hover:shadow-sm text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition-all"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo size={18} />
                </button>
             </div>

            <div className="text-xs text-slate-500 mr-4 hidden sm:block">
               {selectedIds.length === 0 ? 'No selection' : `${selectedIds.length} item(s)`}
            </div>
            {selectedIds.length > 0 && (
              <button 
                onClick={handleDelete}
                className="flex items-center space-x-2 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-sm font-medium transition-colors border border-red-200 mr-2"
                title="Delete Selected (Backspace/Delete)"
              >
                <Trash2 size={16} />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}

            {onUpload && (
              <label className="cursor-pointer flex items-center space-x-2 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-sm font-medium transition-colors shadow-sm mr-2">
                <Upload size={16} />
                <span className="hidden sm:inline">Open</span>
                <input 
                  type="file" 
                  accept=".svg" 
                  onChange={onUpload} 
                  className="hidden" 
                />
              </label>
            )}

            <button 
              onClick={handleDownloadPdf}
              className="flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-sm font-medium transition-colors border border-slate-200 mr-2"
              title="Export as PDF"
            >
              <FileText size={16} />
              <span className="hidden sm:inline">PDF</span>
            </button>

            <button 
              onClick={handleDownload}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
       </div>

       {/* Main Work Area */}
       <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Layers */}
          <div 
             ref={layerPanelRef}
             className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/50"
             tabIndex={0}
             onKeyDown={handleLayerListKeyDown}
          >
             <div className="h-10 border-b border-slate-100 flex items-center px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
               <Layers size={14} className="mr-2" />
               Layers
             </div>
             <div className="flex-1 overflow-hidden">
                <LayerPanel 
                    layers={layerTree} 
                    selectedIds={selectedIds} 
                    onSelect={handleTreeSelect} 
                />
             </div>
          </div>

          {/* Canvas Area */}
          <div className="flex-1 overflow-hidden relative flex items-center justify-center bg-slate-100/50 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
              <div 
                className="relative shadow-xl border border-slate-200 bg-white group/canvas" 
                style={{ width: `${canvasSize.width}px`, height: `${canvasSize.height}px` }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseLeave={handleCanvasMouseLeave}
              >
                {/* User Content Layer */}
                <div 
                  id="canvas-container"
                  ref={containerRef}
                  className="absolute inset-0"
                />

                {/* Overlay Layer for Gizmos & Selection Box */}
                <svg 
                  className="absolute inset-0 pointer-events-none overflow-visible"
                  style={{ width: '100%', height: '100%' }}
                  viewBox={svgConfig.viewBox}
                  preserveAspectRatio={svgConfig.preserveAspectRatio}
                >
                   {selectionRect && (
                       <rect
                          x={selectionRect.x}
                          y={selectionRect.y}
                          width={selectionRect.width}
                          height={selectionRect.height}
                          fill="rgba(59, 130, 246, 0.2)"
                          stroke="#3b82f6"
                          strokeWidth="1"
                          vectorEffect="non-scaling-stroke"
                       />
                   )}

                   {hoverBbox && !gizmoTransform && (
                      <rect 
                         x={hoverBbox.x}
                         y={hoverBbox.y}
                         width={hoverBbox.width}
                         height={hoverBbox.height}
                         fill="none"
                         stroke="#3b82f6"
                         strokeWidth="2"
                         strokeDasharray="4 4"
                         pointerEvents="none"
                         opacity="0.6"
                      />
                   )}

                   {bbox && (
                      <g transform={gizmoTransform} style={{ pointerEvents: 'auto' }}>
                        <TransformGizmo 
                          bbox={bbox} 
                          rotation={rotation}
                          onMouseDown={handleGizmoMouseDown} 
                        />
                      </g>
                   )}
                </svg>

                {/* Canvas Resize Handles */}
                <div 
                  className="absolute top-0 bottom-0 -right-2 w-4 cursor-e-resize z-20 hover:bg-blue-200/50 transition-colors opacity-0 hover:opacity-100"
                  onMouseDown={(e) => handleCanvasResizeStart('canvas-resizing-r', e)}
                />
                <div 
                  className="absolute left-0 right-0 -bottom-2 h-4 cursor-s-resize z-20 hover:bg-blue-200/50 transition-colors opacity-0 hover:opacity-100"
                  onMouseDown={(e) => handleCanvasResizeStart('canvas-resizing-b', e)}
                />
                <div 
                  className="absolute -right-2 -bottom-2 w-5 h-5 cursor-se-resize z-30 bg-white border border-slate-300 rounded shadow-sm hover:bg-blue-500 transition-colors flex items-center justify-center group/resizer"
                  onMouseDown={(e) => handleCanvasResizeStart('canvas-resizing-br', e)}
                >
                    <div className="w-1.5 h-1.5 bg-slate-400 rounded-full group-hover/resizer:bg-white" />
                </div>
                
                {/* Size Label during resize */}
                {interactionRef.current.mode.startsWith('canvas-resizing') && (
                    <div className="absolute -bottom-10 right-0 bg-slate-800 text-white text-xs px-2 py-1 rounded shadow pointer-events-none">
                        {Math.round(canvasSize.width)} x {Math.round(canvasSize.height)}
                    </div>
                )}
              </div>

              {/* Help Overlay */}
              <div className="absolute bottom-4 left-4 right-auto bg-white/90 backdrop-blur p-3 rounded-lg shadow border border-slate-200 text-xs text-slate-500 pointer-events-none max-w-md">
                <p>• <strong>Click</strong> to select, <strong>Drag</strong> background to box-select.</p>
                <p>• <strong>Shift+Click</strong> in list for range selection.</p>
                <p>• <strong>Arrow Keys</strong> to move items (Shift for 10x).</p>
                <p>• <strong>Drag Edges</strong> of canvas to resize it.</p>
                <p>• <strong>Delete</strong> to remove. <strong>Ctrl+Z</strong> to Undo.</p>
              </div>
          </div>
       </div>
    </div>
  );
};

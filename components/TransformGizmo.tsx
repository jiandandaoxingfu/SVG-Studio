import React from 'react';

interface TransformGizmoProps {
  bbox: { x: number; y: number; width: number; height: number };
  rotation: number;
  onMouseDown: (mode: any, e: React.MouseEvent) => void;
}

export const TransformGizmo: React.FC<TransformGizmoProps> = ({ bbox, rotation, onMouseDown }) => {
  const { x, y, width, height } = bbox;
  const handleSize = 8 / (window.devicePixelRatio || 1); // Scale handle size based on view usually, but fixed for now
  
  // Calculate center
  const cx = x + width / 2;
  const cy = y + height / 2;

  // Rotation handle position (top center, slightly above)
  const rotDist = 30;
  const rotX = cx;
  const rotY = y - rotDist;

  // Styles
  const strokeColor = "#3b82f6"; // blue-500
  const fillColor = "#ffffff";
  const handleStyle = { fill: fillColor, stroke: strokeColor, strokeWidth: 1.5, cursor: 'pointer' };

  // We need to apply the rotation to the gizmo itself so it aligns with the element
  const transformStr = `rotate(${rotation}, ${cx}, ${cy})`;

  return (
    <g transform={transformStr} className="gizmo-overlay">
      {/* Bounding Box */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1"
        style={{ pointerEvents: 'none' }} 
        // pointerEvents none on box so we can drag the element underneath, 
        // or we can catch drag on the box if we want. 
        // Let's rely on the parent to catch 'drag' on the element itself, 
        // but often it's easier to put a transparent rect here to capture drag.
      />

      {/* Drag Area (Invisible fill to catch clicks if element is hollow) */}
      <rect 
         x={x} y={y} width={width} height={height} 
         fill="transparent" 
         cursor="move"
         onMouseDown={(e) => onMouseDown('dragging', e)}
      />

      {/* Rotation Handle Line */}
      <line x1={cx} y1={y} x2={rotX} y2={rotY} stroke={strokeColor} strokeWidth="1" />
      {/* Rotation Handle */}
      <circle
        cx={rotX}
        cy={rotY}
        r={5}
        {...handleStyle}
        fill={strokeColor}
        cursor="grab"
        onMouseDown={(e) => onMouseDown('rotating', e)}
      />

      {/* Scale Handles */}
      {/* Top Left */}
      <circle
        cx={x}
        cy={y}
        r={5}
        {...handleStyle}
        cursor="nw-resize"
        onMouseDown={(e) => onMouseDown('scaling-tl', e)}
      />
      {/* Top Right */}
      <circle
        cx={x + width}
        cy={y}
        r={5}
        {...handleStyle}
        cursor="ne-resize"
        onMouseDown={(e) => onMouseDown('scaling-tr', e)}
      />
      {/* Bottom Left */}
      <circle
        cx={x}
        cy={y + height}
        r={5}
        {...handleStyle}
        cursor="sw-resize"
        onMouseDown={(e) => onMouseDown('scaling-bl', e)}
      />
      {/* Bottom Right */}
      <circle
        cx={x + width}
        cy={y + height}
        r={5}
        {...handleStyle}
        cursor="se-resize"
        onMouseDown={(e) => onMouseDown('scaling-br', e)}
      />
    </g>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Box, Layers, Image as ImageIcon, Type, Circle, Square, MousePointer2 } from 'lucide-react';

export interface LayerNode {
  id: string;
  tagName: string;
  children?: LayerNode[];
  name?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  // Store raw attributes to reconstruct shape for better preview visibility
  geometry?: {
    type: string;
    attrs: Record<string, string | null>;
  };
}

interface LayerPanelProps {
  layers: LayerNode[];
  selectedIds: string[];
  onSelect: (id: string, e: React.MouseEvent) => void;
}

const getReadableName = (tagName: string) => {
  const map: Record<string, string> = {
    'g': 'Group',
    'rect': 'Rectangle',
    'circle': 'Circle',
    'ellipse': 'Ellipse',
    'line': 'Line',
    'polyline': 'Polyline',
    'polygon': 'Polygon',
    'path': 'Path',
    'image': 'Image',
    'text': 'Text',
    'tspan': 'Text Span',
    'use': 'Instance'
  };
  return map[tagName] || tagName.charAt(0).toUpperCase() + tagName.slice(1);
};

const getIconForTag = (tagName: string) => {
  switch (tagName) {
    case 'g': return <Layers size={14} className="text-slate-500" />;
    case 'image': return <ImageIcon size={14} className="text-purple-600" />;
    case 'text': return <Type size={14} className="text-slate-600" />;
    case 'circle':
    case 'ellipse': return <Circle size={14} className="text-blue-600" />;
    case 'rect': return <Square size={14} className="text-blue-600" />;
    case 'path': return <MousePointer2 size={14} className="text-orange-600" />;
    default: return <Box size={14} className="text-slate-400" />;
  }
};

const ShapePreview: React.FC<{ node: LayerNode; viewBox: string }> = ({ node, viewBox }) => {
  if (!node.geometry) {
     // Fallback for complex elements like groups or text where we use <use>
     return (
        <svg viewBox={viewBox} className="w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
             <use href={`#${node.id}`} />
        </svg>
     );
  }

  const { type, attrs } = node.geometry;
  
  // Clean attributes for React (convert nulls to undefined, handle styles)
  const props: any = {};
  Object.entries(attrs).forEach(([key, val]) => {
     if (val !== null) props[key] = val;
  });

  // Default stroke for line-like elements if missing or explicitly black but invisible?
  // Actually, if stroke is missing on a <line>, it is invisible. We should default it to black.
  // And we want to ensure black lines are visible.
  if (['line', 'polyline', 'path'].includes(type) && !props.stroke) {
     props.stroke = '#000000';
  }

  // Force visibility enhancements
  const style = {
     vectorEffect: 'non-scaling-stroke', // Keeps lines visible regardless of scale
     strokeWidth: 1.5, // Minimum visible thickness
     ...props.style // Keep original styles but let our overrides win if needed (React style object merge)
  };

  const Element = type as any;

  return (
    <svg viewBox={viewBox} className="w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
        <Element 
            {...props} 
            style={style} 
        />
    </svg>
  );
};

const LayerItem: React.FC<{ 
  node: LayerNode; 
  level: number; 
  selectedIds: string[]; 
  onSelect: (id: string, e: React.MouseEvent) => void;
}> = ({ node, level, selectedIds, onSelect }) => {
  // Default to expanded (true)
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedIds.includes(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const itemRef = useRef<HTMLDivElement>(null);
  
  // Check if any child is selected to auto-expand
  useEffect(() => {
     if (hasChildren && !expanded) {
         // Check if any selectedId belongs to this node's subtree
         const checkSelected = (n: LayerNode): boolean => {
             if (selectedIds.includes(n.id)) return true;
             if (n.children) return n.children.some(checkSelected);
             return false;
         };
         // We only care about children here since we are the parent
         if (node.children!.some(checkSelected)) {
             setExpanded(true);
         }
     }
  }, [selectedIds, hasChildren, expanded, node.children]);

  // Auto-scroll into view when selected
  useEffect(() => {
    if (isSelected && itemRef.current) {
        itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

  const handleClick = (e: React.MouseEvent) => {
    // Pass event directly to parent to handle Shift/Ctrl logic
    onSelect(node.id, e);
  };

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  const getPreviewViewBox = () => {
    if (!node.bbox) return "0 0 100 100";
    const { x, y, width, height } = node.bbox;
    
    const cx = x + width / 2;
    const cy = y + height / 2;
    
    const maxDim = Math.max(width, height);
    const minSize = 20; 
    const size = Math.max(maxDim, minSize);
    const padding = size * 0.5;
    const viewSize = size + padding;
    
    const vbX = cx - viewSize / 2;
    const vbY = cy - viewSize / 2;
    
    return `${vbX} ${vbY} ${viewSize} ${viewSize}`;
  };

  return (
    <div className="select-none font-sans">
      <div 
        ref={itemRef}
        className={`
            group flex items-center py-2 pr-3 cursor-pointer transition-colors duration-150 border-b border-slate-50 relative h-14
            ${isSelected ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50'}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" />}
        
        <div 
          className={`mr-1 p-1 rounded-sm hover:bg-black/5 transition-colors cursor-pointer flex-shrink-0 text-slate-400 ${hasChildren ? 'visible' : 'invisible'}`}
          onClick={toggleExpand}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        
        <div className="mr-2.5 shrink-0 flex items-center justify-center">
          {getIconForTag(node.tagName)}
        </div>
        
        <span className={`text-sm truncate mr-2 flex-1 ${isSelected ? 'font-semibold' : 'font-medium'}`}>
          {node.name || getReadableName(node.tagName)}
        </span>

        {/* Preview Area */}
        {node.bbox && (node.bbox.width > 0 || node.bbox.height > 0 || ['path', 'line', 'circle', 'rect'].includes(node.tagName)) && (
           <div className={`
                relative w-10 h-10 rounded border bg-white flex items-center justify-center shrink-0 
                shadow-sm transition-all duration-200 z-10 group/preview
                ${isSelected ? 'border-blue-200' : 'border-slate-200'}
                hover:scale-[1.2] hover:z-50 hover:shadow-lg origin-center
           `}>
              <div className="w-full h-full overflow-hidden rounded">
                  <ShapePreview node={node} viewBox={getPreviewViewBox()} />
              </div>
           </div>
        )}
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children!.map(child => (
            <LayerItem 
              key={child.id} 
              node={child} 
              level={level + 1} 
              selectedIds={selectedIds}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const LayerPanel: React.FC<LayerPanelProps> = ({ layers, selectedIds, onSelect }) => {
  if (layers.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400 text-sm mt-10">
        <Layers size={32} className="mx-auto mb-2 opacity-50" />
        <p>No layers found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar pb-10 bg-white">
      {layers.map(node => (
        <LayerItem 
          key={node.id} 
          node={node} 
          level={0} 
          selectedIds={selectedIds}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};

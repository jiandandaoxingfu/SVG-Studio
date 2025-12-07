
import React, { useState } from 'react';
import { SvgEditor } from './components/SvgEditor';
import { Upload } from 'lucide-react';

// Default SVG to show before upload
const DEMO_SVG = `
<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:rgb(59,130,246);stop-opacity:1" />
      <stop offset="100%" style="stop-color:rgb(147,51,234);stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect id="bg" x="0" y="0" width="800" height="600" fill="#f8fafc" />
  <circle id="circle-1" cx="400" cy="300" r="100" fill="url(#grad1)" />
  <rect id="rect-1" x="200" y="150" width="150" height="150" fill="#ef4444" opacity="0.8" transform="rotate(15 275 225)" />
  <path id="star-1" d="M100,50 L120,90 L160,95 L130,120 L140,160 L100,140 L60,160 L70,120 L40,95 L80,90 Z" fill="#eab308" transform="translate(450, 100) scale(1.5)" />
  <text id="text-1" x="400" y="500" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#334155">Click shapes to edit</text>
</svg>
`;

function App() {
  const [svgContent, setSvgContent] = useState<string>(DEMO_SVG);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setSvgContent(content);
      };
      reader.readAsText(file);
    } else {
      alert("Please upload a valid SVG file.");
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col font-sans">
      {svgContent ? (
        <SvgEditor initialContent={svgContent} onUpload={handleFileUpload} />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 space-y-4">
          <div className="p-10 border-2 border-dashed border-slate-300 rounded-xl bg-white flex flex-col items-center">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
              <Upload size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Upload SVG</h2>
            <p className="text-slate-500 mt-2 mb-6 text-center max-w-sm">
              Select an SVG file from your computer to start editing.
            </p>
            <label className="cursor-pointer px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors">
              Choose File
              <input 
                type="file" 
                accept=".svg" 
                onChange={handleFileUpload} 
                className="hidden" 
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

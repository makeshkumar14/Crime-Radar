'use client';
import { ArrowRight } from 'lucide-react';

export function FlowButton({ text = "Modern Button", onClick, className = "", isActive = false }) {
  return (
    <button 
      onClick={onClick}
      className={`group relative flex items-center justify-center gap-1 overflow-hidden rounded-[100px] border-[1.5px] border-white/10 bg-transparent px-8 py-3 text-sm font-semibold text-white cursor-pointer transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-transparent hover:text-white hover:rounded-[12px] active:scale-[0.95] ${
        isActive ? "border-transparent rounded-[12px]" : ""
      } ${className}`}
    >
      <ArrowRight 
        className={`absolute w-4 h-4 left-[-25%] stroke-white fill-none z-[9] group-hover:left-4 group-hover:stroke-white transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          isActive ? "left-4" : ""
        }`} 
      />

      <span className="relative z-[1] transition-all duration-[800ms] ease-out">
        {text}
      </span>

      <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-[#af1b1b] rounded-[50%] opacity-0 group-hover:w-[220px] group-hover:h-[220px] group-hover:opacity-100 transition-all duration-[800ms] ease-[cubic-bezier(0.19,1,0.22,1)] ${
        isActive ? "w-[220px] h-[220px] opacity-100" : ""
      }`}></span>

      <ArrowRight 
        className={`absolute w-4 h-4 right-4 stroke-white fill-none z-[9] group-hover:right-[-25%] group-hover:stroke-white transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          isActive ? "right-[-25%]" : ""
        }`} 
      />
    </button>
  );
}

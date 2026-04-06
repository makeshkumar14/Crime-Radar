'use client';
import { FlowButton } from './FlowButton';

function FlowButtonDemo() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black p-8 gap-8">
      <h1 className="text-white text-xl font-black uppercase tracking-widest">
        Flow Button Preview
      </h1>
      <FlowButton text="Flow Button" />
      <FlowButton text="Crime Radar" className="w-[300px]" />
    </div>
  );
}

export default FlowButtonDemo;

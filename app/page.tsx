'use client';

import { useState } from 'react';
import MorningDispatch from '@/components/MorningDispatch';
import EveningDebrief from '@/components/EveningDebrief';
import WeeklyEdgelands from '@/components/WeeklyEdgelands';

type Panel = 'morning' | 'evening' | 'weekly';

export default function Home() {
  const [activePanel, setActivePanel] = useState<Panel>('morning');

  return (
    <>
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex justify-center bg-warm/92 backdrop-blur-sm border-b border-border">
        {[
          { id: 'morning' as Panel, label: 'Morning Dispatch' },
          { id: 'evening' as Panel, label: 'Evening Debrief' },
          { id: 'weekly' as Panel, label: 'Weekly Edgelands' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActivePanel(tab.id); window.scrollTo(0, 0); }}
            className={`font-mono text-[10px] tracking-[2px] uppercase px-6 py-3.5 border-b-2 transition-all ${
              activePanel === tab.id
                ? 'text-accent border-accent'
                : 'text-muted border-transparent hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Panels */}
      {activePanel === 'morning' && <MorningDispatch />}
      {activePanel === 'evening' && <EveningDebrief />}
      {activePanel === 'weekly' && <WeeklyEdgelands />}
    </>
  );
}

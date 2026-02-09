'use client';

import { useState } from 'react';

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function EveningDebrief() {
  const [entry, setEntry] = useState('');
  const now = new Date();

  return (
    <div className="min-h-screen" style={{ background: '#1e1d1a', color: '#d4cfc4' }}>
      <div className="max-w-[640px] mx-auto px-7 pt-20 pb-24">

        {/* Header */}
        <header className="text-center pb-9 mb-10 relative">
          <div className="font-mono text-[9px] font-normal tracking-[5px] uppercase mb-5" style={{ color: '#c4a97d' }}>
            Evening Debrief
          </div>
          <h1 className="font-serif text-4xl font-light tracking-tight mb-1.5" style={{ color: '#d4cfc4' }}>
            {formatDate(now)}
          </h1>
          <div className="font-serif text-[15px] font-normal tracking-wide" style={{ color: '#8a8478' }}>
            The day is winding down
          </div>
          <p className="font-serif text-[19px] font-light italic mt-6 leading-relaxed max-w-[480px] mx-auto" style={{ color: '#c4a97d' }}>
            What&apos;s worth remembering?
          </p>
          <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: '#4a463e' }} />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 px-4 text-[8px] tracking-[6px]" style={{ background: '#1e1d1a', color: '#4a463e' }}>&#9670;</div>
        </header>

        {/* The Chronicler Asks */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#c4a97d' }}>What Happened Today</span>
            <span className="flex-1 h-px" style={{ background: '#4a463e' }} />
          </div>

          <div className="p-5 mb-3.5" style={{ background: '#33312d', border: '1px solid #4a463e' }}>
            <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase mb-2" style={{ color: '#c4a97d' }}>
              The Chronicler Asks
            </div>
            <p className="font-serif text-[17px] italic leading-relaxed" style={{ color: '#d4cfc4' }}>
              Tell me about today — by voice or by text. What did you do, what did you notice, what surprised you? I&apos;ll sort it into the record.
            </p>
          </div>

          <textarea
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder="What happened today..."
            className="w-full p-4 text-sm leading-relaxed resize-y min-h-[100px] focus:outline-none"
            style={{
              background: '#33312d',
              border: '1px solid #4a463e',
              color: '#d4cfc4',
              fontFamily: 'var(--font-sans)',
            }}
          />
        </section>

        {/* Separator */}
        <div className="text-center py-5 text-[8px] tracking-[8px]" style={{ color: '#4a463e' }}>&#9670; &#9670; &#9670;</div>

        {/* Placeholder sections */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#c4a97d' }}>The Chronicler Logs</span>
            <span className="flex-1 h-px" style={{ background: '#4a463e' }} />
          </div>
          <p className="text-[13px] italic" style={{ color: '#8a8478' }}>
            Share what happened today, and the Chronicler will log it by category — land, garden, people, insights, and more.
          </p>
        </section>

        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#c4a97d' }}>Energy Reading</span>
            <span className="flex-1 h-px" style={{ background: '#4a463e' }} />
          </div>
          <div className="p-4" style={{ background: '#33312d', borderLeft: '3px solid #7a9468' }}>
            <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase mb-1.5" style={{ color: '#7a9468' }}>
              Today&apos;s Energy
            </div>
            <p className="text-[13.5px] leading-relaxed" style={{ color: '#d4cfc4' }}>
              Log your evening debrief above, and your energy reading will appear here.
            </p>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center pt-9 mt-5" style={{ borderTop: '1px solid #4a463e' }}>
          <div className="font-mono text-[8px] tracking-[4px] uppercase" style={{ color: '#4a463e' }}>
            Edgelands · Evening
          </div>
          <div className="font-mono text-[10px] mt-1.5" style={{ color: '#8a8478' }}>
            Rest well. The record is kept.
          </div>
        </footer>
      </div>
    </div>
  );
}

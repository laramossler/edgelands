'use client';

import { useEffect, useState } from 'react';
import type { EnergyBreakdown } from '@/types';

interface DashboardData {
  weeklyEnergy: {
    planned?: EnergyBreakdown;
    actual?: EnergyBreakdown;
    logsCount: number;
  };
}

const ENERGY_COLORS: Record<string, string> = {
  colleagues: '#5a6f87',
  airbnb: '#b08a3e',
  forest: '#5e7252',
  creative: '#8f5f5f',
  personal: '#b8a67a',
};

function getWeekNumber(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - start.getTime();
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

export default function WeeklyEdgelands() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const now = new Date();
  const weekNum = getWeekNumber(now);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.ok ? res.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const planned = data?.weeklyEnergy?.planned || {};
  const actual = data?.weeklyEnergy?.actual || {};
  const categories = [...new Set([...Object.keys(planned), ...Object.keys(actual)])].filter(k => k !== 'date' && k !== 'user_id' && k !== 'id' && k !== 'week_start');

  return (
    <div className="min-h-screen" style={{ background: '#f0ede5' }}>
      <div className="max-w-[640px] mx-auto px-7 pt-20 pb-24">

        {/* Header */}
        <header className="text-center pb-9 mb-10 relative">
          <div className="font-mono text-[9px] font-normal tracking-[5px] uppercase mb-5" style={{ color: '#5a6f87' }}>
            Edgelands · Weekly Review
          </div>
          <h1 className="font-serif text-4xl font-light text-ink tracking-tight mb-1.5">
            Week {weekNum} in Review
          </h1>
          <div className="font-serif text-[15px] font-normal tracking-wide text-muted">
            {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </div>
          <p className="font-serif text-[19px] font-light italic mt-6 leading-relaxed max-w-[480px] mx-auto" style={{ color: '#5a6f87' }}>
            Let&apos;s look at where your energy actually went — and where you want it to go next.
          </p>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 px-4 text-[8px] tracking-[6px] bg-border" style={{ background: '#f0ede5', color: '#ddd6c8' }}>&#9670;</div>
        </header>

        {/* Energy: Planned vs Actual */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#5a6f87' }}>Energy: Planned vs. Actual</span>
            <span className="flex-1 h-px bg-border" />
          </div>

          {isLoading ? (
            <p className="text-[13px] italic text-muted">Loading energy data...</p>
          ) : categories.length > 0 ? (
            <div className="space-y-2.5 mb-6">
              {categories.map((cat) => {
                const plannedVal = (planned as any)[cat] || 0;
                const actualVal = (actual as any)[cat] || 0;
                const color = ENERGY_COLORS[cat] || '#8a8478';
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <div className="font-mono text-[10px] tracking-[1px] uppercase w-[90px] text-right flex-shrink-0" style={{ color }}>
                      {cat}
                    </div>
                    <div className="flex-1 h-6 rounded-sm relative overflow-hidden" style={{ background: '#e0dbd0' }}>
                      <div className="absolute top-0 left-0 h-full rounded-sm opacity-30" style={{ width: `${plannedVal}%`, background: color }} />
                      <div className="relative h-full rounded-sm" style={{ width: `${actualVal}%`, background: color }} />
                    </div>
                    <div className="font-mono text-[10px] text-muted w-16 flex-shrink-0">
                      {actualVal}%{plannedVal > 0 && actualVal !== plannedVal && (
                        <span style={{ color: actualVal > plannedVal ? '#8f5f5f' : '#5e7252' }}> {actualVal > plannedVal ? '↑' : '↓'} {plannedVal}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <p className="text-[12px] text-muted italic mt-2">Faded bar = planned allocation. Solid bar = actual.</p>
            </div>
          ) : (
            <p className="text-[13px] italic text-muted mb-6">No energy data logged yet this week. Use the chat or quick log to start tracking.</p>
          )}
        </section>

        {/* Separator */}
        <div className="text-center py-5 text-[8px] tracking-[8px] text-border">&#9670; &#9670; &#9670;</div>

        {/* Strategic Questions */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#5a6f87' }}>Strategic Questions</span>
            <span className="flex-1 h-px bg-border" />
          </div>

          {[
            'Where did your energy go this week that surprised you?',
            'What got deferred that you said was important?',
            'What needs to be true for next week to feel right?',
          ].map((q, i) => (
            <div key={i} className="bg-card border border-border p-5 mb-3">
              <p className="font-serif text-[17px] italic leading-relaxed text-ink mb-2.5">{q}</p>
              <textarea
                placeholder="Your thoughts..."
                className="w-full border border-border p-3 text-sm leading-relaxed resize-y min-h-[60px] focus:outline-none"
                style={{ background: '#f0ede5', color: '#2c2a25', fontFamily: 'var(--font-sans)' }}
              />
            </div>
          ))}
        </section>

        {/* Separator */}
        <div className="text-center py-5 text-[8px] tracking-[8px] text-border">&#9670; &#9670; &#9670;</div>

        {/* Next Week */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#5a6f87' }}>Non-Negotiables for Next Week</span>
            <span className="flex-1 h-px bg-border" />
          </div>
          <p className="text-[12.5px] text-muted italic mb-3.5">Maximum four. What must happen no matter what?</p>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="mb-2">
              <input
                type="text"
                placeholder={`${n}.`}
                className="w-full bg-card border border-border px-3.5 py-2.5 text-[13px] text-ink focus:outline-none"
                style={{ fontFamily: 'var(--font-sans)' }}
              />
            </div>
          ))}
        </section>

        {/* Seasonal */}
        <section className="mb-10">
          <div className="p-6" style={{ background: 'linear-gradient(160deg, #f1ece1, #e6dfd0)' }}>
            <p className="font-serif text-[16px] italic leading-relaxed text-ink">
              Take a breath. Set your direction for the week. Then let it unfold. You don&apos;t have to hold everything at once.
            </p>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center pt-9 mt-5 border-t border-border">
          <div className="font-mono text-[8px] tracking-[4px] uppercase text-border">
            Edgelands Review · Week {weekNum}
          </div>
          <div className="font-mono text-[10px] text-muted mt-1.5">
            Set your direction. Then let the week unfold.
          </div>
        </footer>
      </div>
    </div>
  );
}

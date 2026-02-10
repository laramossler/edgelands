'use client';

import { useEffect, useState } from 'react';
import type { DebriefCategoryItem, EnergyReading } from '@/types';

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

const categoryLabels: Record<string, string> = {
  land: 'Land & Property',
  garden: 'Garden & Forest',
  people: 'People',
  work: 'Work',
  body: 'Body',
  creative: 'Creative',
  insights: 'Insights',
};

const categoryIcons: Record<string, string> = {
  land: '⌂',
  garden: '↟',
  people: '◎',
  work: '▢',
  body: '◇',
  creative: '✦',
  insights: '·',
};

const energyColors: Record<string, string> = {
  colleagues: '#5a6f87',
  airbnb: '#b08a3e',
  forest: '#5e7252',
  personal: '#b8a67a',
  other: '#8a8478',
};

const energyLabels: Record<string, string> = {
  colleagues: 'Work',
  airbnb: 'Property',
  forest: 'Land & Garden',
  personal: 'Personal',
  other: 'Other',
};

interface DebriefResult {
  categories: DebriefCategoryItem[];
  energy: EnergyReading;
  chronicler_note: string;
}

interface PastEntry {
  id: string;
  date: string;
  raw_entry: string;
  categories: DebriefCategoryItem[];
  energy_reading: EnergyReading;
  chronicler_note?: string;
}

export default function EveningDebrief() {
  const [entry, setEntry] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<DebriefResult | null>(null);
  const [pastEntries, setPastEntries] = useState<PastEntry[]>([]);
  const [showPast, setShowPast] = useState(false);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  useEffect(() => {
    loadToday();
    loadPast();
  }, []);

  const loadToday = async () => {
    try {
      const res = await fetch(`/api/debrief?date=${todayStr}`);
      if (res.ok) {
        const data = await res.json();
        if (data.entry) {
          setEntry(data.entry.raw_entry || '');
          setResult({
            categories: data.entry.categories || [],
            energy: data.entry.energy_reading || null,
            chronicler_note: data.entry.chronicler_note || '',
          });
        }
      }
    } catch {}
  };

  const loadPast = async () => {
    try {
      const res = await fetch('/api/debrief');
      if (res.ok) {
        const data = await res.json();
        setPastEntries((data.entries || []).filter((e: PastEntry) => e.date !== todayStr));
      }
    } catch {}
  };

  const submit = async () => {
    if (!entry.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/debrief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry: entry.trim(), date: todayStr }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult({
          categories: data.categories || [],
          energy: data.energy || null,
          chronicler_note: data.chronicler_note || '',
        });
      }
    } catch {}
    setIsSubmitting(false);
  };

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
            rows={6}
            className="w-full p-4 text-sm leading-relaxed resize-y min-h-[120px] focus:outline-none"
            style={{
              background: '#33312d',
              border: '1px solid #4a463e',
              color: '#d4cfc4',
              fontFamily: 'var(--font-sans)',
            }}
          />

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={submit}
              disabled={isSubmitting || !entry.trim()}
              className="px-5 py-2 text-[11px] font-medium tracking-wide uppercase disabled:opacity-40 transition-opacity"
              style={{ background: '#c4a97d', color: '#1e1d1a' }}
            >
              {isSubmitting ? 'The Chronicler is reading...' : result ? 'Update Entry' : 'Submit to the Chronicler'}
            </button>
            {result && (
              <span className="text-[11px]" style={{ color: '#7a9468' }}>Logged</span>
            )}
          </div>
        </section>

        {/* Chronicler's Response */}
        {isSubmitting && (
          <div className="mb-10 p-5" style={{ background: '#33312d', borderLeft: '3px solid #c4a97d' }}>
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#c4a97d' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#c4a97d', animationDelay: '200ms' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#c4a97d', animationDelay: '400ms' }} />
              </div>
              <span className="font-serif text-[13px] italic" style={{ color: '#c4a97d' }}>Sorting into the record...</span>
            </div>
          </div>
        )}

        {result && !isSubmitting && (
          <>
            {/* Separator */}
            <div className="text-center py-5 text-[8px] tracking-[8px]" style={{ color: '#4a463e' }}>&#9670; &#9670; &#9670;</div>

            {/* Chronicler Note */}
            {result.chronicler_note && (
              <section className="mb-10">
                <div className="p-5" style={{ background: '#33312d', borderLeft: '3px solid #c4a97d' }}>
                  <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase mb-2" style={{ color: '#c4a97d' }}>
                    The Chronicler Notes
                  </div>
                  <p className="font-serif text-[15px] italic leading-relaxed" style={{ color: '#d4cfc4' }}>
                    {result.chronicler_note}
                  </p>
                </div>
              </section>
            )}

            {/* Categories */}
            <section className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#c4a97d' }}>The Chronicler Logs</span>
                <span className="flex-1 h-px" style={{ background: '#4a463e' }} />
              </div>

              <div className="space-y-4">
                {result.categories.map((cat) => (
                  <div key={cat.category} className="p-4" style={{ background: '#33312d', border: '1px solid #4a463e' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[14px]" style={{ color: '#c4a97d' }}>{categoryIcons[cat.category] || '·'}</span>
                      <span className="font-mono text-[9px] tracking-[2px] uppercase" style={{ color: '#c4a97d' }}>
                        {categoryLabels[cat.category] || cat.category}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {cat.items.map((item, i) => (
                        <li key={i} className="text-[13.5px] leading-relaxed pl-5" style={{ color: '#d4cfc4' }}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* Energy Reading */}
            {result.energy && (
              <section className="mb-10">
                <div className="flex items-center gap-3 mb-4">
                  <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#c4a97d' }}>Energy Reading</span>
                  <span className="flex-1 h-px" style={{ background: '#4a463e' }} />
                </div>

                <div className="p-5" style={{ background: '#33312d', borderLeft: '3px solid #7a9468' }}>
                  <div className="font-mono text-[8.5px] tracking-[1.5px] uppercase mb-3" style={{ color: '#7a9468' }}>
                    Today&apos;s Energy
                  </div>

                  {/* Bars */}
                  <div className="space-y-2.5 mb-4">
                    {Object.entries({
                      colleagues: result.energy.colleagues_pct,
                      airbnb: result.energy.airbnb_pct,
                      forest: result.energy.forest_pct,
                      personal: result.energy.personal_pct,
                      other: result.energy.other_pct,
                    }).filter(([, pct]) => pct > 0).map(([key, pct]) => (
                      <div key={key}>
                        <div className="flex justify-between mb-1">
                          <span className="font-mono text-[9px] tracking-wide uppercase" style={{ color: '#8a8478' }}>
                            {energyLabels[key] || key}
                          </span>
                          <span className="font-mono text-[9px]" style={{ color: '#8a8478' }}>
                            {pct}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full" style={{ background: '#4a463e' }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: energyColors[key] || '#8a8478' }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {result.energy.narrative && (
                    <p className="text-[13px] italic leading-relaxed" style={{ color: '#d4cfc4' }}>
                      {result.energy.narrative}
                    </p>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {/* No result placeholder */}
        {!result && !isSubmitting && (
          <>
            <div className="text-center py-5 text-[8px] tracking-[8px]" style={{ color: '#4a463e' }}>&#9670; &#9670; &#9670;</div>

            <section className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#c4a97d' }}>The Chronicler Logs</span>
                <span className="flex-1 h-px" style={{ background: '#4a463e' }} />
              </div>
              <p className="text-[13px] italic" style={{ color: '#8a8478' }}>
                Share what happened today, and the Chronicler will log it by category.
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
          </>
        )}

        {/* Past entries toggle */}
        {pastEntries.length > 0 && (
          <section className="mb-10">
            <button
              onClick={() => setShowPast(!showPast)}
              className="flex items-center gap-3 w-full text-left"
            >
              <span className="font-mono text-[9px] font-normal tracking-[4px] uppercase" style={{ color: '#c4a97d' }}>
                Recent Entries ({pastEntries.length})
              </span>
              <span className="flex-1 h-px" style={{ background: '#4a463e' }} />
              <span className="font-mono text-[10px]" style={{ color: '#8a8478' }}>
                {showPast ? '▴' : '▾'}
              </span>
            </button>

            {showPast && (
              <div className="mt-4 space-y-4">
                {pastEntries.map(pe => (
                  <div key={pe.id} className="p-4" style={{ background: '#33312d', border: '1px solid #4a463e' }}>
                    <div className="flex justify-between mb-2">
                      <span className="font-mono text-[9px] tracking-wide" style={{ color: '#c4a97d' }}>
                        {new Date(pe.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <span className="font-mono text-[9px]" style={{ color: '#8a8478' }}>
                        {(pe.categories || []).map(c => categoryIcons[c.category] || '·').join(' ')}
                      </span>
                    </div>
                    <p className="text-[12.5px] leading-relaxed line-clamp-3" style={{ color: '#d4cfc4' }}>
                      {pe.raw_entry}
                    </p>
                    {pe.chronicler_note && (
                      <p className="text-[11.5px] italic mt-2 pt-2" style={{ color: '#8a8478', borderTop: '1px solid #4a463e' }}>
                        {pe.chronicler_note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

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

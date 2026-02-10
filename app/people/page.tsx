'use client';

import { useEffect, useState } from 'react';
import PeopleList from '@/components/PeopleList';
import Link from 'next/link';
import type { Person } from '@/types';

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [needingContact, setNeedingContact] = useState<number>(0);
  const [isPopulating, setIsPopulating] = useState(false);
  const [populateStatus, setPopulateStatus] = useState('');

  useEffect(() => {
    fetchPeople();
  }, []);

  const fetchPeople = async () => {
    try {
      const [allRes, nudgeRes] = await Promise.all([
        fetch('/api/people'),
        fetch('/api/people?view=needing_contact'),
      ]);

      if (allRes.ok) {
        const data = await allRes.json();
        setPeople(data.people || []);
      }

      if (nudgeRes.ok) {
        const data = await nudgeRes.json();
        setNeedingContact(data.count || 0);
      }
    } catch (error) {
      console.error('Failed to fetch people:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const autoPopulate = async () => {
    setIsPopulating(true);
    setPopulateStatus('Scanning emails and classifying senders...');
    try {
      const res = await fetch('/api/people/auto-populate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      });
      if (res.ok) {
        const data = await res.json();
        setPopulateStatus(`Created ${data.created} people from ${data.total_discovered} discovered senders.`);
        await fetchPeople();
      } else {
        setPopulateStatus('Failed to auto-populate. Check logs.');
      }
    } catch {
      setPopulateStatus('Error running auto-populate.');
    } finally {
      setIsPopulating(false);
      setTimeout(() => setPopulateStatus(''), 10000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted">Loading People Database...</div>
      </div>
    );
  }

  // Group by circle for summary
  const circleCount = people.reduce((acc, p) => {
    acc[p.circle] = (acc[p.circle] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">People Database</h1>
          <p className="text-muted text-sm mt-1">
            {people.length} people across {Object.keys(circleCount).length} circles
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={autoPopulate}
            disabled={isPopulating}
            className="text-sm px-3 py-1 bg-accent text-white rounded disabled:opacity-50"
          >
            {isPopulating ? 'Scanning...' : 'Auto-populate from Email'}
          </button>
          <Link
            href="/correspondent"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Correspondent
          </Link>
          <Link
            href="/"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* Auto-populate status */}
      {populateStatus && (
        <div className="border border-accent/20 rounded-lg p-4 bg-accent/5">
          <p className="text-sm text-foreground">{populateStatus}</p>
        </div>
      )}

      {/* Nudge summary */}
      {needingContact > 0 && (
        <div className="border border-accent/20 rounded-lg p-4 bg-accent/5">
          <p className="text-sm text-foreground">
            <span className="font-medium">{needingContact} {needingContact === 1 ? 'person' : 'people'}</span>
            <span className="text-muted"> overdue for contact</span>
          </p>
        </div>
      )}

      {/* Circle summary */}
      {people.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {Object.entries(circleCount).map(([circle, count]) => (
            <div key={circle} className="border border-muted/20 rounded px-3 py-1">
              <span className="text-muted">{circle}:</span>{' '}
              <span className="text-foreground">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* People list */}
      <PeopleList people={people} onUpdate={fetchPeople} />
    </div>
  );
}

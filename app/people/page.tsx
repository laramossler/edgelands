'use client';

import { useEffect, useState } from 'react';
import PeopleList from '@/components/PeopleList';
import Link from 'next/link';
import type { Person } from '@/types';

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [needingContact, setNeedingContact] = useState<number>(0);

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

'use client';

import type { Relationship } from '@/types';

interface RelationshipDashboardProps {
  relationships: Relationship[];
}

export default function RelationshipDashboard({ relationships }: RelationshipDashboardProps) {
  const needsContact = relationships.filter((r) => {
    if (!r.last_contact_date) return true;

    const daysSince = Math.floor(
      (Date.now() - new Date(r.last_contact_date).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (r.tier === 1 && daysSince > 7) return true;
    if (r.tier === 2 && daysSince > 14) return true;

    return false;
  });

  const getTierColor = (tier: number) => {
    switch (tier) {
      case 1:
        return 'text-accent';
      case 2:
        return 'text-blue-400';
      case 3:
        return 'text-muted';
      default:
        return 'text-muted';
    }
  };

  if (needsContact.length === 0) {
    return (
      <div className="text-muted text-sm">
        All relationships are up to date! 🌲
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {needsContact.map((relationship) => {
        const daysSince = relationship.last_contact_date
          ? Math.floor(
              (Date.now() - new Date(relationship.last_contact_date).getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : null;

        return (
          <div
            key={relationship.id}
            className="flex items-center justify-between border border-muted/20 rounded p-3"
          >
            <div className="flex items-center gap-3">
              <span className={`font-medium ${getTierColor(relationship.tier)}`}>
                T{relationship.tier}
              </span>
              <span className="text-foreground">{relationship.name}</span>
            </div>

            <span className="text-sm text-muted">
              {daysSince === null ? 'Never' : `${daysSince}d ago`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

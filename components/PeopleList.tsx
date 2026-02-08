'use client';

import { useState } from 'react';
import type { Person, Circle } from '@/types';

interface PeopleListProps {
  people: Person[];
  onUpdate: () => void;
}

const CIRCLES: Circle[] = ['family', 'neighbor', 'friend', 'professional', 'community', 'acquaintance'];

export default function PeopleList({ people, onUpdate }: PeopleListProps) {
  const [filter, setFilter] = useState<Circle | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    nickname: '',
    circle: 'friend' as Circle,
    closeness: 3,
    relationship: '',
    email: '',
    phone: '',
    ideal_cadence: 'monthly',
    communication_style: '',
    care_notes: '',
    notes: '',
    location: '',
    occupation: '',
    interests: '',
    birthday: '',
  });

  const filtered = filter === 'all'
    ? people
    : people.filter(p => p.circle === filter);

  const getCircleColor = (circle: string) => {
    switch (circle) {
      case 'family': return 'text-accent border-accent/30';
      case 'friend': return 'text-blue-400 border-blue-400/30';
      case 'neighbor': return 'text-green-400 border-green-400/30';
      case 'professional': return 'text-purple-400 border-purple-400/30';
      case 'community': return 'text-orange-400 border-orange-400/30';
      case 'acquaintance': return 'text-muted border-muted/30';
      default: return 'text-muted border-muted/30';
    }
  };

  const resetForm = () => {
    setFormData({
      name: '', nickname: '', circle: 'friend', closeness: 3,
      relationship: '', email: '', phone: '', ideal_cadence: 'monthly',
      communication_style: '', care_notes: '', notes: '', location: '',
      occupation: '', interests: '', birthday: '',
    });
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (person: Person) => {
    setFormData({
      name: person.name,
      nickname: person.nickname || '',
      circle: person.circle,
      closeness: person.closeness,
      relationship: person.relationship,
      email: (person.email || []).join(', '),
      phone: (person.phone || []).join(', '),
      ideal_cadence: person.ideal_cadence || 'monthly',
      communication_style: person.communication_style || '',
      care_notes: person.care_notes || '',
      notes: person.notes || '',
      location: person.location || '',
      occupation: person.occupation || '',
      interests: (person.interests || []).join(', '),
      birthday: person.birthday || '',
    });
    setEditingId(person.id);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.relationship) return;
    setIsSubmitting(true);

    const payload: any = {
      name: formData.name,
      circle: formData.circle,
      closeness: formData.closeness,
      relationship: formData.relationship,
    };

    if (formData.nickname) payload.nickname = formData.nickname;
    if (formData.email) payload.email = formData.email.split(',').map(e => e.trim()).filter(Boolean);
    if (formData.phone) payload.phone = formData.phone.split(',').map(p => p.trim()).filter(Boolean);
    if (formData.ideal_cadence) payload.ideal_cadence = formData.ideal_cadence;
    if (formData.communication_style) payload.communication_style = formData.communication_style;
    if (formData.care_notes) payload.care_notes = formData.care_notes;
    if (formData.notes) payload.notes = formData.notes;
    if (formData.location) payload.location = formData.location;
    if (formData.occupation) payload.occupation = formData.occupation;
    if (formData.interests) payload.interests = formData.interests.split(',').map(i => i.trim()).filter(Boolean);
    if (formData.birthday) payload.birthday = formData.birthday;

    try {
      if (editingId) {
        await fetch(`/api/people?id=${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/people', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      resetForm();
      onUpdate();
    } catch (error) {
      console.error('Failed to save person:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this person from the People Database?')) return;

    try {
      await fetch(`/api/people?id=${id}`, { method: 'DELETE' });
      onUpdate();
    } catch (error) {
      console.error('Failed to delete person:', error);
    }
  };

  const getDaysSinceContact = (person: Person): string => {
    if (!person.last_contact) return 'never';
    const days = Math.floor(
      (Date.now() - new Date(person.last_contact).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded text-sm transition-colors ${
            filter === 'all'
              ? 'bg-accent text-background'
              : 'border border-muted/20 text-muted hover:text-foreground'
          }`}
        >
          All ({people.length})
        </button>
        {CIRCLES.map(circle => {
          const count = people.filter(p => p.circle === circle).length;
          if (count === 0) return null;
          return (
            <button
              key={circle}
              onClick={() => setFilter(circle)}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                filter === circle
                  ? 'bg-accent text-background'
                  : 'border border-muted/20 text-muted hover:text-foreground'
              }`}
            >
              {circle} ({count})
            </button>
          );
        })}
      </div>

      {/* Add person button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 border border-dashed border-muted/30 rounded-lg text-sm text-muted hover:text-foreground hover:border-muted/50 transition-colors"
        >
          + Add person
        </button>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div className="border border-accent/20 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-medium text-foreground">
            {editingId ? 'Edit Person' : 'New Person'}
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Name *"
              value={formData.name}
              onChange={e => setFormData(d => ({ ...d, name: e.target.value }))}
              className="bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              placeholder="Nickname"
              value={formData.nickname}
              onChange={e => setFormData(d => ({ ...d, nickname: e.target.value }))}
              className="bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
            />
          </div>

          <input
            type="text"
            placeholder="Relationship (e.g. mother, design partner, neighbor) *"
            value={formData.relationship}
            onChange={e => setFormData(d => ({ ...d, relationship: e.target.value }))}
            className="w-full bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
          />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={formData.circle}
              onChange={e => setFormData(d => ({ ...d, circle: e.target.value as Circle }))}
              className="bg-background border border-muted/20 rounded p-2 text-sm text-foreground focus:outline-none focus:border-accent"
            >
              {CIRCLES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <label className="text-sm text-muted">Closeness:</label>
              <input
                type="range"
                min="1"
                max="5"
                value={formData.closeness}
                onChange={e => setFormData(d => ({ ...d, closeness: parseInt(e.target.value) }))}
                className="flex-1"
              />
              <span className="text-sm text-foreground w-4">{formData.closeness}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Email(s), comma-separated"
              value={formData.email}
              onChange={e => setFormData(d => ({ ...d, email: e.target.value }))}
              className="bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              placeholder="Phone(s), comma-separated"
              value={formData.phone}
              onChange={e => setFormData(d => ({ ...d, phone: e.target.value }))}
              className="bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Location"
              value={formData.location}
              onChange={e => setFormData(d => ({ ...d, location: e.target.value }))}
              className="bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              placeholder="Occupation"
              value={formData.occupation}
              onChange={e => setFormData(d => ({ ...d, occupation: e.target.value }))}
              className="bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
            />
            <input
              type="date"
              placeholder="Birthday"
              value={formData.birthday}
              onChange={e => setFormData(d => ({ ...d, birthday: e.target.value }))}
              className="bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
            />
          </div>

          <input
            type="text"
            placeholder="Interests (comma-separated)"
            value={formData.interests}
            onChange={e => setFormData(d => ({ ...d, interests: e.target.value }))}
            className="w-full bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
          />

          <textarea
            placeholder="Communication style (how to write to them)"
            value={formData.communication_style}
            onChange={e => setFormData(d => ({ ...d, communication_style: e.target.value }))}
            rows={2}
            className="w-full bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
          />

          <textarea
            placeholder="Care notes (what they are going through)"
            value={formData.care_notes}
            onChange={e => setFormData(d => ({ ...d, care_notes: e.target.value }))}
            rows={2}
            className="w-full bg-background border border-muted/20 rounded p-2 text-sm text-foreground placeholder-muted focus:outline-none focus:border-accent"
          />

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !formData.name || !formData.relationship}
              className="px-4 py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Add Person'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 border border-muted/20 rounded text-sm text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* People list */}
      <div className="space-y-2">
        {filtered.map(person => {
          const isExpanded = expandedId === person.id;

          return (
            <div
              key={person.id}
              className="border border-muted/20 rounded-lg overflow-hidden"
            >
              {/* Row */}
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/5 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : person.id)}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded border ${getCircleColor(person.circle)}`}>
                    {person.closeness}
                  </span>
                  <div>
                    <span className="text-foreground font-medium">{person.name}</span>
                    {person.nickname && (
                      <span className="text-muted text-sm ml-1">({person.nickname})</span>
                    )}
                    <span className="text-muted text-sm ml-2">{person.relationship}</span>
                  </div>
                </div>
                <span className="text-sm text-muted">
                  {getDaysSinceContact(person)}
                </span>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-muted/10 space-y-2">
                  {person.care_notes && (
                    <div className="text-sm"><span className="text-muted">Care notes:</span> {person.care_notes}</div>
                  )}
                  {person.communication_style && (
                    <div className="text-sm"><span className="text-muted">Style:</span> {person.communication_style}</div>
                  )}
                  {person.location && (
                    <div className="text-sm"><span className="text-muted">Location:</span> {person.location}</div>
                  )}
                  {person.occupation && (
                    <div className="text-sm"><span className="text-muted">Occupation:</span> {person.occupation}</div>
                  )}
                  {person.interests && person.interests.length > 0 && (
                    <div className="text-sm"><span className="text-muted">Interests:</span> {person.interests.join(', ')}</div>
                  )}
                  {person.ideal_cadence && (
                    <div className="text-sm"><span className="text-muted">Cadence:</span> {person.ideal_cadence}</div>
                  )}
                  {person.next_touchpoint && (
                    <div className="text-sm">
                      <span className="text-muted">Next:</span> {person.next_touchpoint}
                      {person.touchpoint_date && ` (${person.touchpoint_date})`}
                    </div>
                  )}
                  {person.email && person.email.length > 0 && (
                    <div className="text-sm"><span className="text-muted">Email:</span> {person.email.join(', ')}</div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(person); }}
                      className="px-3 py-1 border border-muted/20 rounded text-xs text-muted hover:text-foreground transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(person.id); }}
                      className="px-3 py-1 border border-red-400/20 rounded text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-muted text-sm text-center py-4">
          No people in this circle yet.
        </div>
      )}
    </div>
  );
}

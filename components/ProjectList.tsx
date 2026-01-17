'use client';

import type { Project } from '@/types';

interface ProjectListProps {
  projects: Project[];
  maxDisplay?: number;
}

export default function ProjectList({ projects, maxDisplay = 3 }: ProjectListProps) {
  const displayProjects = projects.slice(0, maxDisplay);

  const getStateBadgeColor = (state: Project['state']) => {
    switch (state) {
      case 'active':
        return 'bg-accent text-background';
      case 'glacier':
        return 'bg-blue-600 text-foreground';
      case 'compost':
        return 'bg-muted text-foreground';
      default:
        return 'bg-muted text-foreground';
    }
  };

  if (projects.length === 0) {
    return (
      <div className="text-muted text-sm">
        No projects yet. Start a conversation with Claude to add one.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {displayProjects.map((project) => (
        <div key={project.id} className="border border-muted/20 rounded p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-foreground font-medium">{project.name}</h3>
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${getStateBadgeColor(
                project.state
              )}`}
            >
              {project.state}
            </span>
          </div>

          {project.description && (
            <p className="text-sm text-muted">{project.description}</p>
          )}

          {project.domain && (
            <div className="text-xs text-muted">
              Domain: {project.domain}
            </div>
          )}
        </div>
      ))}

      {projects.length > maxDisplay && (
        <div className="text-sm text-muted text-center">
          +{projects.length - maxDisplay} more projects
        </div>
      )}
    </div>
  );
}

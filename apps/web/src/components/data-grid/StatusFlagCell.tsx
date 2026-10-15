import type { Project } from '@tracker/shared';
import { computeProjectFlag, FLAG_LABEL, type ProjectFlag } from '../../lib/projectStatus';
import { Badge } from '../ui/Badge';
import type { ComponentProps } from 'react';

const FLAG_VARIANT: Record<ProjectFlag, ComponentProps<typeof Badge>['variant']> = {
  idle: 'warning',
  deadline: 'danger',
  finish: 'success',
  ok: 'neutral',
};

export function StatusFlagCell({ project }: { project: Project }) {
  const flag = computeProjectFlag(project);
  if (flag === 'ok') {
    return <span className="text-xs text-ink-muted/70">—</span>;
  }
  return (
    <Badge variant={FLAG_VARIANT[flag]} title={FLAG_LABEL[flag]}>
      {FLAG_LABEL[flag]}
    </Badge>
  );
}

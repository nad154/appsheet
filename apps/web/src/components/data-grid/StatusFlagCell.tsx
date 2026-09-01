import type { Project } from '@tracker/shared';
import { computeProjectFlag, FLAG_LABEL, type ProjectFlag } from '../../lib/projectStatus';

const FLAG_STYLES: Record<ProjectFlag, string> = {
  idle: 'bg-amber-100 text-amber-800 border-amber-300',
  deadline: 'bg-red-100 text-red-800 border-red-300',
  finish: 'bg-green-100 text-green-800 border-green-300',
  ok: 'bg-gray-100 text-gray-600 border-gray-200',
};

export function StatusFlagCell({ project }: { project: Project }) {
  const flag = computeProjectFlag(project);
  if (flag === 'ok') {
    return <span className="text-xs text-gray-400">—</span>;
  }
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${FLAG_STYLES[flag]}`}
      title={FLAG_LABEL[flag]}
    >
      {FLAG_LABEL[flag]}
    </span>
  );
}

export const ROLES = ['SUPER_ADMIN', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const PROJECT_STAGES = ['on_progress', 'finish'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const GOODS_OR_SERVICE = ['service', 'goods'] as const;
export type GoodsOrService = (typeof GOODS_OR_SERVICE)[number];

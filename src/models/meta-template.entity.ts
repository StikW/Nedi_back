const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

export type MetaTemplateStatus = 'approved' | 'pending' | 'rejected';

export interface MetaTemplate {
  id: string;
  name: string;
  category: string;
  language: string;
  status: MetaTemplateStatus;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export const META_TEMPLATES_TABLE = _tablePrefix + 'MetaTemplates';

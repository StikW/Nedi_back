const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

export type MetaContactStatus = 'active' | 'inactive';

export interface MetaContact {
  id: string;
  name: string;
  company?: string;
  phone: string;
  email?: string;
  status: MetaContactStatus;
  createdAt: string;
  updatedAt: string;
}

export const META_CONTACTS_TABLE = _tablePrefix + 'MetaContacts';

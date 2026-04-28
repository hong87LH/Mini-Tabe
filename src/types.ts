export type FieldType = 'text' | 'number' | 'singleSelect' | 'multiSelect' | 'date' | 'checkbox' | 'person' | 'url' | 'attachment' | 'aiText';

export interface SelectOption {
  id: string;
  name: string;
  color: string; // Tailwind color class or hex
}

export interface Attachment {
  id: string;
  url: string;
  name: string;
}

export interface Field {
  id: string;
  name: string;
  type: FieldType;
  options?: SelectOption[];
  width?: number;
  prompt?: string; // For aiText
  refFields?: string[]; // For aiText
}

export interface BaseRecord {
  id: string;
  [fieldId: string]: any;
}

export interface GridData {
  fields: Field[];
  records: BaseRecord[];
}

